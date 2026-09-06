import { IntercomRuntime, type IntercomRuntimeState } from './core/runtime';
import { waitForIceGatheringComplete } from './core/sfu';
import type { IntercomSnapshot, ServerIntercomEnvelope } from './core/protocol';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

// Controlled group signaling with native Chrome RTP and audio tracks.
export async function run() {
  const runtime = new IntercomRuntime();
  const listeners = new Set<(message: ServerIntercomEnvelope) => void>();
  let leaveRequestId = '';
  const snapshot: IntercomSnapshot = { revision: 1, topologyRevision: 1, groupCode: '123456', participants: [{
    id: 'engineer', role: 'engineer', displayName: 'Engineer', online: true, speaking: false, ptt: false,
    busEnabled: true, forcedMuted: false, talkingTo: [], assignmentDriverKey: 'driver',
  }] };
  runtime.setTransport({
    generation: 1, joined: true, intercomVersion: 1,
    sendIntercom(message) {
      if (message.type === 'intercom_join') queueMicrotask(() => {
        for (const listener of listeners) listener({ type: 'intercom_joined', requestId: message.requestId, payload: {
          groupCode: '123456', participantId: 'engineer', membershipGeneration: 1, resumeToken: 'resume',
          sfuEnabled: false, snapshot,
        } });
      });
      if (message.type === 'intercom_leave') leaveRequestId = message.requestId ?? '';
      return true;
    },
    subscribeIntercom(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const rawTrack = destination.stream.getAudioTracks()[0];
  const publication = rawTrack.clone();
  const sender = new RTCPeerConnection({ iceServers: [] });
  const receiver = new RTCPeerConnection({ iceServers: [] });
  const element = document.createElement('audio');
  document.body.append(element);
  try {
    await runtime.join({ groupCode: '123456', password: 'test-only', role: 'engineer', displayName: 'Engineer' });
    check(runtime.getState().status === 'joined', 'Group did not join.');
    await context.resume();
    oscillator.connect(destination);
    oscillator.start();
    receiver.ontrack = (event) => {
      element.srcObject = new MediaStream([event.track]);
      void element.play();
      const source = context.createMediaStreamSource(new MediaStream([event.track]));
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(sink);
      sink.connect(context.destination);
    };
    const transceiver = sender.addTransceiver(publication, { direction: 'sendonly' });
    await sender.setLocalDescription(await sender.createOffer());
    await waitForIceGatheringComplete(sender);
    await receiver.setRemoteDescription(sender.localDescription!);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await waitForIceGatheringComplete(receiver);
    await sender.setRemoteDescription(receiver.localDescription!);
    const received = async () => {
      let total = 0;
      let packets = 0;
      (await receiver.getStats()).forEach((stat) => {
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          total += stat.totalAudioEnergy ?? 0;
          packets += stat.packetsReceived ?? 0;
        }
      });
      return { energy: total, packets };
    };
    const deadline = Date.now() + 5_000;
    while ((await received()).energy === 0) {
      check(Date.now() < deadline, 'Native RTP pair received no audio before Leave.');
      await wait(20);
    }
    const inner = runtime as unknown as {
      state: IntercomRuntimeState;
      audio: { pc: RTCPeerConnection; rawTrack: MediaStreamTrack; publications: object[] };
    };
    inner.audio.pc = sender;
    inner.audio.rawTrack = rawTrack;
    inner.audio.publications = [{ key: 'engineer_bus', clone: publication, sender: transceiver.sender, transceiver }];
    inner.state = { ...inner.state, mediaStatus: 'connected', microphoneStatus: 'live' };
    runtime.setBusEnabled(true);
    const leaving = runtime.leave();
    check(leaveRequestId && !publication.enabled, 'Leave did not immediately disable publication.');
    check(publication.readyState === 'ended' && rawTrack.readyState === 'ended', 'Leave retained a live audio track.');
    check(sender.connectionState === 'closed', 'Leave retained the native RTP connection.');
    await wait(150); // Drain audio already received before the local close.
    const before = await received();
    for (const listener of listeners) listener({ type: 'intercom_state', payload: { ...snapshot, revision: 2 } });
    await wait(250);
    const after = await received();
    check(!publication.enabled && runtime.getState().status === 'ready', 'A pre-ACK snapshot revived membership.');
    // The receiver can synthesize concealment audio after RTP stops. Count
    // received packets to distinguish newly transmitted audio from concealment.
    check(after.packets === before.packets, `RTP continued after Leave: ${after.packets - before.packets}`);
    for (const listener of listeners) listener({ type: 'intercom_left', requestId: leaveRequestId, payload: {} });
    await leaving;
    return { suite: 'intercom leave', nativeRTP: true, receivedPacketsAfterLeave: after.packets - before.packets };
  } finally {
    runtime.close();
    publication.stop();
    rawTrack.stop();
    sender.close();
    receiver.close();
    oscillator.stop();
    element.remove();
    await context.close();
  }
}
