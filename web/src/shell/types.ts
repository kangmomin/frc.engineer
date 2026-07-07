import type { ViewId } from './viewNav';

/** AppShell 이 각 뷰에 내려주는 셸 컨트롤 (nav + 보조 기능 진입점). */
export interface ShellControls {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  onOpenRooms: () => void;
  onOpenArchive: () => void;
  onOpenSetup: () => void;
  onGoHome: () => void;
  /** 비활성 탭 (예: 비-quali 세션의 QUALI). */
  navDisabled?: Partial<Record<ViewId, boolean>>;
  /** 현재 원격 룸 액션 라벨/활성 (구 remoteAction 대응). */
  roomsActive?: boolean;
}
