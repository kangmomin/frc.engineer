// @ts-nocheck
/**
 * F1 25 Setup Manager — Pitwall Command Terminal
 * Full version with all 5 tabs: Setup, Teams, Compare, MySetup, Ask
 */
import { useState, useRef, useEffect, useMemo } from 'react';

const API_URL = "https://api.anthropic.com/v1/messages";
const ENV_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

const TD=[{name:"Australia",flag:"\u{1F1E6}\u{1F1FA}",round:1},{name:"China",flag:"\u{1F1E8}\u{1F1F3}",round:2,sprint:true},{name:"Japan",flag:"\u{1F1EF}\u{1F1F5}",round:3},{name:"Bahrain",flag:"\u{1F1E7}\u{1F1ED}",round:4},{name:"Jeddah",flag:"\u{1F1F8}\u{1F1E6}",round:5},{name:"Miami",flag:"\u{1F1FA}\u{1F1F8}",round:6,sprint:true},{name:"Imola",flag:"\u{1F1EE}\u{1F1F9}",round:7},{name:"Monaco",flag:"\u{1F1F2}\u{1F1E8}",round:8},{name:"Spain",flag:"\u{1F1EA}\u{1F1F8}",round:9},{name:"Canada",flag:"\u{1F1E8}\u{1F1E6}",round:10},{name:"Austria",flag:"\u{1F1E6}\u{1F1F9}",round:11},{name:"Silverstone",flag:"\u{1F1EC}\u{1F1E7}",round:12},{name:"Spa",flag:"\u{1F1E7}\u{1F1EA}",round:13,sprint:true},{name:"Hungary",flag:"\u{1F1ED}\u{1F1FA}",round:14},{name:"Zandvoort",flag:"\u{1F1F3}\u{1F1F1}",round:15},{name:"Monza",flag:"\u{1F1EE}\u{1F1F9}",round:16},{name:"Baku",flag:"\u{1F1E6}\u{1F1FF}",round:17},{name:"Singapore",flag:"\u{1F1F8}\u{1F1EC}",round:18},{name:"COTA",flag:"\u{1F1FA}\u{1F1F8}",round:19,sprint:true},{name:"Mexico",flag:"\u{1F1F2}\u{1F1FD}",round:20},{name:"Brazil",flag:"\u{1F1E7}\u{1F1F7}",round:21,sprint:true},{name:"Vegas",flag:"\u{1F1FA}\u{1F1F8}",round:22},{name:"Qatar",flag:"\u{1F1F6}\u{1F1E6}",round:23,sprint:true},{name:"Abu Dhabi",flag:"\u{1F1E6}\u{1F1EA}",round:24}];
function FI({flag,size=20}){return <span style={{fontSize:size,lineHeight:1,display:"inline-block",flexShrink:0}}>{flag}</span>;}
const TEAMS=[{name:"Red Bull",total:55,pros:"최고 프론트 에어로(3.368), 높은 전체 에어로(5.365)",cons:"가장 높은 질량(803kg), 무게배분 불균형(0.204), 기어박스 비효율(1.642)",mass:803,drag:0.01303,aeroF:3.368,aeroR:1.9974,gear:1.6417,wDist:0.204},{name:"McLaren",total:54,pros:"가장 가벼운 차(798kg), 최고 리어 에어로(2.028), 높은 드래그(0.01287)",cons:"프론트 에어로 중간(3.240), 기어박스 중간(1.676)",mass:798,drag:0.01287,aeroF:3.240,aeroR:2.0278,gear:1.6756,wDist:0.180},{name:"Mercedes",total:49,pros:"높은 드래그(0.01290), 낮은 무게배분(0.160), 좋은 리어 에어로(1.985)",cons:"전체 에어로 중간(5.111), 프론트 에어로 중간(3.126)",mass:804,drag:0.01290,aeroF:3.126,aeroR:1.9854,gear:1.6806,wDist:0.160},{name:"Ferrari",total:48,pros:"가벼운 질량(801kg), 낮은 무게배분(0.165)",cons:"낮은 드래그(0.01369), 에어로 중하위(5.005), 기어박스 비효율(1.685)",mass:801,drag:0.01369,aeroF:3.067,aeroR:1.9378,gear:1.6853,wDist:0.165},{name:"Aston Martin",total:44,pros:"높은 프론트 에어로(3.207), 높은 드래그(0.01294)",cons:"무거운 질량(809kg), 리어 에어로 약세(1.930), 기어박스 중간(1.681)",mass:809,drag:0.01294,aeroF:3.207,aeroR:1.9304,gear:1.6806,wDist:0.175},{name:"Alpine",total:38,pros:"최고 드래그(0.01276), 최저 기어박스(1.708), 최저 무게배분(0.158)",cons:"높은 질량(807kg), 전체 에어로 약세(5.004), 리어 에어로 약세(1.926)",mass:807,drag:0.01276,aeroF:3.078,aeroR:1.9264,gear:1.7081,wDist:0.158},{name:"Williams",total:36,pros:"프론트 에어로 중간(3.091)",cons:"무거운 질량(810kg), 낮은 드래그(0.01377), 최약 리어 에어로(1.841), 기어박스 중간(1.681)",mass:810,drag:0.01377,aeroF:3.091,aeroR:1.8405,gear:1.6806,wDist:0.187},{name:"Vcarb",total:32,pros:"드래그 중간(0.01301), 리어 에어로 중간(1.910)",cons:"최약 프론트 에어로(2.806), 최악 기어박스(1.513), 높은 무게배분(0.200)",mass:808,drag:0.01301,aeroF:2.806,aeroR:1.9100,gear:1.5133,wDist:0.200},{name:"Haas",total:30,pros:"무게배분 양호(0.165), 기어박스 중간(1.685)",cons:"최고 질량급(812kg), 리어 에어로 약세(1.810), 전체 에어로 약세(4.823)",mass:812,drag:0.01301,aeroF:3.013,aeroR:1.8098,gear:1.6853,wDist:0.165},{name:"Sauber",total:21,pros:"없음",cons:"최고 질량(813kg), 최저 드래그(0.01497), 최저 에어로(4.207), 최악 무게배분(0.225)",mass:813,drag:0.01497,aeroF:2.566,aeroR:1.6412,gear:1.6853,wDist:0.225}];
const DEFS={fw:{name:"프론트 윙",min:0,max:50},rw:{name:"리어 윙",min:0,max:50},don:{name:"디프 온스로틀",min:10,max:100},doff:{name:"디프 오프스로틀",min:10,max:100},fs:{name:"프론트 서스",min:1,max:41},rs:{name:"리어 서스",min:1,max:41},fa:{name:"프론트 안티롤바",min:1,max:21},ra:{name:"리어 안티롤바",min:1,max:21},frh:{name:"프론트 RH",min:15,max:35},rrh:{name:"리어 RH",min:40,max:60},bb:{name:"브레이크 바이어스",min:50,max:70},bp:{name:"브레이크 압력",min:80,max:100},fl:{name:"FL 압력",min:22.5,max:29.5},fr:{name:"FR 압력",min:22.5,max:29.5},rl:{name:"RL 압력",min:20.5,max:26.5},rr:{name:"RR 압력",min:20.5,max:26.5}};
const FIELDS=[{k:"fw",l:"프론트 윙"},{k:"rw",l:"리어 윙"},{k:"don",l:"온스로틀 디프"},{k:"doff",l:"오프스로틀 디프"},{k:"fs",l:"프론트 서스"},{k:"rs",l:"리어 서스"},{k:"fa",l:"프론트 안티롤바"},{k:"ra",l:"리어 안티롤바"},{k:"frh",l:"프론트 RH"},{k:"rrh",l:"리어 RH"},{k:"bb",l:"브레이크 바이어스"},{k:"bp",l:"브레이크 압력"},{k:"fl",l:"FL 압력"},{k:"fr",l:"FR 압력"},{k:"rl",l:"RL 압력"},{k:"rr",l:"RR 압력"}];
const RK=[{k:"fw",l:"FW"},{k:"rw",l:"RW"},{k:"don",l:"DON"},{k:"doff",l:"DOFF"},{k:"fs",l:"FS"},{k:"rs",l:"RS"},{k:"fa",l:"FA"},{k:"ra",l:"RA"},{k:"frh",l:"FRH"},{k:"rrh",l:"RRH"},{k:"bb",l:"BB"},{k:"bp",l:"BP"}];

const SM=[{key:"ip_r",label:"푸키 Race",color:"#a855f7",group:"Istvan Puki",rain:false,desc:"프로 리그 롱런",who:"고급자"},{key:"ip_q",label:"푸키 Quali",color:"#c084fc",group:"Istvan Puki",rain:false,desc:"프로 리그 숏런",who:"고급자"},{key:"ip_i",label:"푸키 Inter",color:"#22c55e",group:"Istvan Puki",rain:true,desc:"인터미디에이트",who:"비"},{key:"ip_w",label:"푸키 Wet",color:"#3b82f6",group:"Istvan Puki",rain:true,desc:"풀 웻",who:"폭우"},{key:"es_r",label:"Esports Race",color:"#ec4899",group:"Istvan Puki",rain:false,desc:"중급자 레이스",who:"중급자"},{key:"es_q",label:"Esports Quali",color:"#f472b6",group:"Istvan Puki",rain:false,desc:"중급자 퀄리",who:"중급자"},{key:"sf_r",label:"Safe Race",color:"#f97316",group:"Istvan Puki",rain:false,desc:"초보자 안정형",who:"초보자"},{key:"sf_q",label:"Safe Quali",color:"#fb923c",group:"Istvan Puki",rain:false,desc:"초보자 퀄리",who:"초보자"},{key:"bl_r",label:"BL Race",color:"#eab308",group:"Brendon Leigh",rain:false,desc:"BL 타이어 관리",who:"일반"},{key:"bl_q",label:"BL Quali",color:"#facc15",group:"Brendon Leigh",rain:false,desc:"BL 퀄리",who:"일반"},{key:"bl_i",label:"BL Inter",color:"#34d399",group:"Brendon Leigh",rain:true,desc:"BL 인터",who:"비"},{key:"bl_w",label:"BL Wet",color:"#60a5fa",group:"Brendon Leigh",rain:true,desc:"BL 웻",who:"폭우"},{key:"gn_i",label:"Inter Setup",color:"#10b981",group:"General",rain:true,desc:"일반 인터미디에이트",who:"전체",dbKey:"ip_i"},{key:"gn_w",label:"Wet Setup",color:"#6366f1",group:"General",rain:true,desc:"일반 풀 웻",who:"전체",dbKey:"ip_w"}];
const getDbKey=(meta)=>meta.dbKey||meta.key;

const DB={"Australia":{ip_r:mk(20,8,100,20,41,1,4,16,22,40,55,100,29.5,29.5,22,22),ip_q:mk(20,4,100,20,41,2,6,21,22,40,53,100,29.5,29.5,25,25),ip_i:mk(30,28,90,30,41,10,8,19,20,50,54,100,29.5,29.5,26.5,26.5),ip_w:mk(38,23,100,20,41,1,5,20,21,40,54,100,27.5,27.5,23,23),es_r:mk(15,9,100,30,41,1,1,16,21,40,53,100,29.5,29.5,26.5,26.5),es_q:mk(18,8,100,25,41,1,1,21,20,40,53,100,29.5,29.5,21,21),sf_r:mk(10,5,90,30,41,1,1,1,22,42,54,100,29.5,29.5,26.5,26.5),sf_q:mk(13,7,90,30,41,1,1,15,21,41,54,100,29.5,29.5,26.5,26.5),bl_r:mk(10,0,100,30,41,1,3,21,20,40,54,100,29.5,29.5,22,22),bl_q:mk(13,0,100,30,41,1,3,21,20,40,54,100,29.5,29.5,22,22),bl_i:mk(25,15,100,30,41,1,3,21,20,40,54,100,29.5,29.5,22,22),bl_w:mk(33,23,100,30,41,1,3,21,20,40,54,100,29.5,29.5,22,22),track:{notes:"DRS존 4개. 언더컷 강력.",softLife:"11랩",medLife:"16랩",hardLife:"23랩",pitWindow50:"랩 9-11",strategy:"1스톱 언더컷. 피트 21초"}},"China":{ip_r:mk(29,17,100,25,40,1,1,8,20,40,54,100,28.2,28.2,20.5,20.5),ip_q:mk(41,23,100,15,41,1,1,20,20,40,53,100,29.5,29.2,20.5,20.5),ip_i:mk(31,28,90,30,41,5,7,21,20,47,53,100,26,26,20.5,20.5),ip_w:mk(50,40,100,10,41,1,1,21,21,40,54,100,27,27,20.5,20.5),es_r:mk(26,20,100,30,41,1,1,8,20,40,55,100,29.5,29.5,26.5,26.5),es_q:mk(32,28,100,25,41,1,1,12,20,40,54,100,29.5,29.5,20.5,20.5),sf_r:mk(25,24,90,25,41,1,1,1,21,44,54,100,29.5,29.5,26.5,26.5),sf_q:mk(28,26,90,30,41,1,1,4,21,44,54,100,29.5,29.5,20.5,20.5),bl_r:mk(30,25,100,30,41,1,1,20,20,44,55,100,29.5,29.5,23,23),bl_q:mk(35,30,100,30,41,1,1,20,20,44,54,100,29.5,29.5,24,24),bl_i:mk(45,40,100,30,41,1,1,20,20,44,54,100,29.5,29.5,23,23),bl_w:mk(50,45,100,30,41,1,1,20,20,44,54,100,29.5,29.5,23,23),track:{notes:"섹터1-2 온도 관리 핵심.",softLife:"8랩",medLife:"11랩",hardLife:"15랩",pitWindow50:"랩 10-12",strategy:"1스톱. 피트 17초"}},"Japan":{ip_r:mk(24,8,100,35,41,1,5,20,21,40,54,100,29.5,29.5,20.5,20.5),ip_q:mk(30,10,100,25,41,1,1,21,23,40,53,100,29.3,29.5,20.5,20.5),ip_i:mk(40,42,90,30,41,15,5,21,22,46,55,100,26.1,26.1,20.5,20.5),ip_w:mk(43,27,100,25,41,1,1,20,22,40,54,100,28.5,28.5,20.5,20.5),es_r:mk(19,13,100,30,41,1,1,21,21,42,53,100,29.5,29.5,26.5,26.5),es_q:mk(28,18,100,25,41,1,1,21,21,42,52,100,29.5,29.5,26.5,26.5),sf_r:mk(15,13,90,35,41,1,1,5,22,41,54,100,29.5,29.5,23.6,23.6),sf_q:mk(15,10,90,30,41,1,1,15,22,41,54,100,29.5,29.5,20.5,20.5),bl_r:mk(31,22,100,30,41,1,5,21,21,42,55,100,29.5,29.5,22,22),bl_q:mk(31,22,100,30,41,1,5,21,21,42,54,100,29.5,29.5,22,22),bl_i:mk(34,24,100,20,41,1,5,21,21,42,54,100,29.5,29.5,22,22),bl_w:mk(38,28,100,20,41,1,5,21,21,42,54,100,29.5,29.5,22,22),track:{notes:"흐름과 모멘텀 핵심.",softLife:"10랩",medLife:"16랩",hardLife:"20랩",pitWindow50:"랩 8-10",strategy:"언더컷. 피트 17.65초"}},"Bahrain":{ip_r:mk(27,21,100,30,40,1,1,16,20,40,55,100,29,29,20.5,20.5),ip_q:mk(33,23,100,20,41,1,1,20,20,40,53,100,28.5,28.5,20.5,20.5),ip_i:mk(50,50,90,25,41,13,9,21,22,46,55,100,26.1,26.1,20.5,20.5),ip_w:mk(50,44,100,20,38,1,1,20,20,40,53,100,28,28,20.5,20.5),es_r:mk(25,20,100,30,41,1,1,7,20,40,54,100,29.5,29.5,24,24),es_q:mk(25,15,100,30,41,1,1,15,20,40,53,100,29.5,29.5,23,23),sf_r:mk(25,22,90,30,41,1,1,1,20,42,55,100,29.5,29.5,23.6,23.6),sf_q:mk(25,20,90,25,41,1,1,7,20,42,54,100,29.5,29.5,23,23),bl_r:mk(30,28,100,35,41,1,5,21,20,40,55,100,29.5,29.5,22,22),bl_q:mk(32,28,100,30,41,1,5,21,20,40,54,100,29.5,29.5,22,22),bl_i:mk(46,41,100,30,41,1,5,21,20,40,54,100,29.5,29.5,22,22),bl_w:mk(50,45,100,30,41,1,5,21,20,40,54,100,29.5,29.5,22,22),track:{notes:"고다운포스. 타이어 마모 중요.",softLife:"11랩",medLife:"12랩",hardLife:"18랩",pitWindow50:"랩 11-13",strategy:"1스톱 or 2스톱. 피트 18.9초"}},"Jeddah":{ip_r:mk(16,0,100,30,41,1,1,13,20,40,55,100,29.5,29.5,21,21),ip_q:mk(15,0,100,20,41,1,1,21,19,40,53,100,29.5,29.5,22,22),ip_i:mk(15,10,90,20,41,5,9,21,20,45,52,100,26,26,20.5,20.5),ip_w:mk(37,23,100,20,41,1,1,21,19,40,53,100,28.5,28.5,20.5,20.5),es_r:mk(8,2,100,20,41,1,1,5,19,40,53,100,29.5,29.5,26.5,26.5),es_q:mk(10,2,100,10,41,1,1,21,19,40,52,100,29.5,29.5,20.5,20.5),sf_r:mk(8,4,90,20,41,1,1,10,21,42,53,100,29.5,29.5,26.5,26.5),sf_q:mk(10,4,90,20,41,1,1,10,21,42,53,100,29.5,29.5,26.5,26.5),bl_r:mk(10,2,100,30,41,1,5,21,20,40,55,100,29.5,29.5,22,22),bl_q:mk(14,6,100,30,41,1,5,21,20,40,54,100,29.5,29.5,22,22),bl_i:mk(30,25,100,25,41,1,5,21,20,40,54,100,29.5,29.5,22,22),bl_w:mk(40,35,100,25,41,1,5,21,20,40,54,100,29.5,29.5,22,22),track:{notes:"리어 마모 최중요.",softLife:"11랩",medLife:"16랩",hardLife:"20랩",pitWindow50:"랩 10-12",strategy:"소프트 금지. 1스톱. 피트 23초"}},"Miami":{ip_r:mk(8,1,100,30,41,1,1,15,20,40,55,100,29,29,21.5,21.5),ip_q:mk(16,5,100,20,41,1,1,21,21,40,54,100,29,29,21,21),ip_i:mk(18,14,90,30,41,1,1,15,20,42,54,100,26,26,20.5,20.5),ip_w:mk(40,32,100,20,41,1,1,20,20,40,54,100,28,28,20.5,20.5),es_r:mk(10,4,100,30,41,1,1,10,21,40,54,100,29.5,29.5,26.5,26.5),es_q:mk(13,3,100,30,41,1,1,15,20,40,54,100,29.5,29.5,20.5,20.5),sf_r:mk(10,7,90,30,41,1,1,1,21,43,55,100,29.5,29.5,26.5,26.5),sf_q:mk(13,10,90,30,41,1,1,5,21,43,55,100,29.5,29.5,20.5,20.5),bl_r:mk(12,6,100,30,41,1,4,21,21,40,55,100,29.5,29.5,22,22),bl_q:mk(14,8,100,30,41,1,4,21,21,40,54,100,29.5,29.5,22,22),bl_i:mk(24,18,100,25,41,1,4,21,21,40,54,100,29.5,29.5,22,22),bl_w:mk(30,24,100,25,41,1,4,21,21,40,54,100,29.5,29.5,22,22),track:{notes:"낮은 윙 고속 서킷.",softLife:"8랩",medLife:"13랩",hardLife:"20랩",pitWindow50:"랩 11-12",strategy:"1스톱 M-H. 피트 21.9초"}},"Monaco":{ip_r:mk(50,50,100,30,39,1,1,15,17,40,54,100,28.5,28.5,20.5,20.5),ip_q:mk(50,45,100,20,38,1,1,21,18,40,52,100,28,28,21,21),ip_i:mk(50,50,90,30,41,1,5,21,20,49,53,100,22.5,22.5,20.5,20.5),ip_w:mk(50,50,100,15,36,1,1,21,17,40,52,100,27,27,20.5,20.5),es_r:mk(50,50,100,20,41,1,1,1,20,40,54,100,22.5,22.5,20.5,20.5),es_q:mk(50,50,100,20,41,1,1,10,20,40,53,100,22.5,22.5,20.5,20.5),sf_r:mk(50,50,90,35,39,1,4,1,20,41,54,100,22.5,22.5,20.5,20.5),sf_q:mk(50,50,90,35,41,1,1,1,20,41,54,100,22.5,22.5,20.5,20.5),bl_r:mk(50,50,100,30,40,1,4,17,21,44,55,100,29.5,29.5,22,22),bl_q:mk(50,50,100,30,40,1,4,17,21,44,54,100,29.5,29.5,20.5,20.5),bl_i:mk(50,50,100,15,40,1,4,17,21,44,54,100,29.5,29.5,20.5,20.5),bl_w:mk(50,50,100,10,40,1,4,17,21,44,54,100,29.5,29.5,20.5,20.5),track:{notes:"의무 2스톱. 오버컷 효과적.",softLife:"13랩",medLife:"19랩",hardLife:"25랩",pitWindow50:"랩 9&20-23",strategy:"의무 2스톱. 피트 18.4초"}},"Spain":{ip_r:mk(34,25,100,30,41,1,1,14,20,40,54,100,29.5,29.3,20.5,20.5),ip_q:mk(42,30,100,20,41,1,1,20,20,40,53,100,29,29,20.5,20.5),ip_i:mk(42,37,90,25,41,1,1,8,21,40,53,100,26.1,26.1,20.5,20.5),ip_w:mk(50,43,100,15,41,1,1,21,19,40,53,100,29.5,29.5,20.5,20.5),es_r:mk(34,24,100,25,41,1,1,10,20,40,53,100,29.5,29.5,23.6,23.6),es_q:mk(37,27,100,20,41,5,1,21,19,40,52,100,29.5,29.5,20.5,20.5),sf_r:mk(34,33,90,30,41,1,1,6,20,42,55,100,29.5,29.5,23.6,23.6),sf_q:mk(37,34,90,25,41,1,1,21,20,42,52,100,29.5,29.5,20.5,20.5),bl_r:mk(30,25,100,30,41,1,4,19,20,41,53,100,29.5,29.5,22,22),bl_q:mk(33,28,100,30,41,1,4,19,20,41,54,100,29.5,29.5,22,22),bl_i:mk(44,39,100,25,41,1,4,19,20,41,54,100,29.5,29.5,22,22),bl_w:mk(50,45,100,20,41,1,4,19,20,41,54,100,29.5,29.5,22,22),track:{notes:"오버테이킹 어려움.",softLife:"13랩",medLife:"18랩",hardLife:"27랩",pitWindow50:"랩 10-14",strategy:"1스톱 M-H. 피트 21.6초"}},"Imola":{ip_r:mk(28,20,100,25,41,1,1,6,21,40,54,100,29.5,29.5,20.5,20.5),ip_q:mk(35,22,100,15,41,1,1,14,21,40,54,100,29.5,29.5,20.5,20.5),ip_i:mk(40,30,90,30,41,1,9,21,22,40,55,100,29.5,29.5,23.6,23.6),ip_w:mk(45,35,100,15,41,1,1,17,20,40,54,100,28,28,20.5,20.5),es_r:mk(30,24,100,30,41,1,1,8,22,40,58,100,29.5,29.5,26.5,26.5),es_q:mk(35,28,100,25,41,1,3,21,22,40,54,100,29.5,29.5,20.5,20.5),sf_r:mk(30,25,90,25,41,1,1,4,22,42,55,100,29.5,29.5,26.5,26.5),sf_q:mk(34,31,90,25,41,1,1,10,22,43,54,100,29.5,29.5,20.5,20.5),bl_r:mk(27,22,100,30,40,1,4,21,22,44,55,100,29.5,29.5,22,22),bl_q:mk(31,26,100,25,40,1,4,21,22,44,54,100,29.5,29.5,22,22),bl_i:mk(34,24,100,25,40,1,4,21,22,44,54,100,29.5,29.5,22,22),bl_w:mk(43,33,100,25,40,1,4,21,22,44,54,100,29.5,29.5,22,22),track:{notes:"오버테이킹 어려움. 소프트 금지.",softLife:"10랩",medLife:"15랩",hardLife:"23랩",pitWindow50:"랩 12-14",strategy:"1스톱. 피트 25초"}},"Canada":{ip_r:mk(25,20,100,30,41,1,1,14,19,40,54,100,29.5,29.5,20.5,20.5),ip_q:mk(34,25,100,20,41,1,1,21,19,40,53,100,29,29,20.5,20.5),ip_i:mk(50,43,100,15,41,1,1,20,18,40,55,100,27,27,20.5,20.5),ip_w:mk(50,43,100,15,41,1,1,18,18,40,55,100,27,27,20.5,20.5),es_r:mk(31,27,100,30,41,1,3,11,20,40,54,100,29.5,29.5,25.8,25.8),es_q:mk(34,29,100,25,41,1,1,11,20,40,53,100,29.5,29.5,20.5,20.5),sf_r:mk(32,30,90,30,41,1,5,11,20,44,55,100,29.5,29.5,25.8,25.8),sf_q:mk(35,33,90,30,41,1,5,11,20,44,54,100,29.5,29.5,26.5,26.5),bl_r:mk(26,24,100,30,41,1,2,21,21,42,55,100,29.5,29.5,22,22),bl_q:mk(31,27,100,30,41,1,2,21,21,42,54,100,29.5,29.5,22,22),bl_i:mk(41,37,100,20,41,1,2,21,21,42,54,100,29.5,29.5,22,22),bl_w:mk(50,44,100,15,41,1,2,21,21,42,54,100,29.5,29.5,22,22),track:{notes:"리어 마모 핵심. 2스톱 추천.",softLife:"13랩",medLife:"27랩",hardLife:"32랩",pitWindow50:"랩 13-14",strategy:"2스톱. 피트 23초"}},"Austria":{ip_r:mk(24,10,100,25,41,1,1,14,20,40,55,100,29.3,29.5,21.5,21.5),ip_q:mk(31,14,100,25,41,1,1,20,20,40,52,100,29.3,29.5,22,22),ip_i:mk(43,39,90,25,41,1,1,5,21,43,53,100,29.5,29.5,25.8,25.8),ip_w:mk(45,33,100,20,41,1,1,20,20,40,54,100,28,28,20.5,20.5),es_r:mk(14,7,100,25,41,1,1,10,19,40,54,100,29.5,29.5,23.6,23.6),es_q:mk(26,12,100,25,41,1,1,21,20,40,54,100,29.5,29.5,20.5,20.5),sf_r:mk(13,10,90,30,41,1,1,5,21,44,55,100,29.5,29.5,23.6,23.6),sf_q:mk(28,25,90,30,41,1,3,21,20,43,54,100,29.5,29.5,20.5,20.5),bl_r:mk(27,13,100,40,41,1,4,21,22,40,54,100,29.5,29.5,22,22),bl_q:mk(30,16,100,40,41,1,4,21,22,40,54,100,29.5,29.5,22,22),bl_i:mk(41,27,100,40,41,1,4,21,22,40,54,100,29.5,29.5,22,22),bl_w:mk(50,40,100,40,41,1,4,21,22,40,54,100,29.5,29.5,22,22),track:{notes:"1스톱 타이어 관리.",softLife:"10랩",medLife:"13랩",hardLife:"23랩",pitWindow50:"랩 15-17",strategy:"피트 18.1초"}},"Silverstone":{ip_r:mk(14,0,100,30,41,1,2,13,20,40,54,100,29,29,21,21),ip_q:mk(17,0,100,20,41,1,1,21,20,40,53,100,29.5,29.5,21.5,21.5),ip_i:mk(20,15,100,30,41,1,1,4,20,40,53,100,29.5,29.5,26.5,26.5),ip_w:mk(36,24,100,20,40,1,1,20,20,40,54,100,27,27,20.5,20.5),es_r:mk(9,3,100,30,41,1,1,21,20,40,53,100,29.5,29.5,26.5,26.5),es_q:mk(8,0,100,25,41,1,1,21,20,40,53,100,29.5,29.5,26.5,26.5),sf_r:mk(10,5,90,35,41,1,5,18,20,40,54,100,29.5,29.5,26.5,26.5),sf_q:mk(9,2,90,30,41,1,5,18,20,40,53,100,29.5,29.5,26.5,26.5),bl_r:mk(18,5,100,35,41,1,3,20,21,40,54,100,29.5,29.5,22,22),bl_q:mk(18,5,100,30,41,1,3,20,21,40,54,100,29.5,29.5,22,22),bl_i:mk(30,22,100,30,41,1,3,20,21,40,54,100,29.5,29.5,22,22),bl_w:mk(40,32,100,30,41,1,3,20,21,40,54,100,29.5,29.5,22,22),track:{notes:"FL 핵심. 언더컷 강력.",softLife:"10랩",medLife:"13랩",hardLife:"20랩",pitWindow50:"랩 9-11",strategy:"1스톱 M-H. 피트 24초"}},"Spa":{ip_r:mk(2,0,100,20,41,1,1,19,21,40,55,100,29,29,24.5,24.5),ip_q:mk(6,0,100,15,41,1,2,21,21,40,53,100,28.8,28.8,26.5,26.5),ip_i:mk(11,5,90,25,41,1,1,21,21,42,53,100,29.5,29.5,23.6,23.6),ip_w:mk(9,6,100,20,41,1,1,19,21,40,53,100,26.5,26.5,25,25),es_r:mk(0,0,100,20,41,1,1,21,21,40,54,100,29.5,29.5,26.5,26.5),es_q:mk(0,0,100,20,41,1,1,21,21,40,53,100,29.5,29.5,26.5,26.5),sf_r:mk(3,1,90,30,41,1,4,21,21,40,54,100,29.5,29.5,26.5,26.5),sf_q:mk(5,2,90,30,41,1,5,21,21,40,54,100,29.5,29.5,26.5,26.5),bl_r:mk(4,0,100,30,41,1,4,21,20,40,55,100,29.5,29.5,22.5,22.5),bl_q:mk(4,0,100,25,41,1,4,21,20,40,55,100,29.5,29.5,22.5,22.5),bl_i:mk(12,6,100,30,41,1,4,21,20,40,55,100,29.5,29.5,22.5,22.5),bl_w:mk(20,14,100,30,41,1,4,21,20,40,55,100,29.5,29.5,22.5,22.5),track:{notes:"중간 섹터 흐름.",softLife:"9랩",medLife:"13랩",hardLife:"23랩",pitWindow50:"랩 13-15",strategy:"1스톱. 피트 19.7초"}},"Hungary":{ip_r:mk(50,50,100,30,41,1,5,19,20,40,54,100,29.5,29.5,20.5,20.5),ip_q:mk(50,48,100,20,41,1,3,21,20,40,53,100,28,28,20.5,20.5),ip_i:mk(44,50,90,30,41,14,8,21,20,49,54,100,29.5,29.5,25.8,25.8),ip_w:mk(50,50,100,20,41,1,4,20,20,40,53,100,28,28,20.5,20.5),es_r:mk(50,50,100,30,41,1,1,5,19,40,54,100,29.5,29.5,25.8,25.8),es_q:mk(50,48,100,20,41,1,1,15,19,40,53,100,29.5,29.5,20.5,20.5),sf_r:mk(50,50,90,30,41,1,1,1,21,43,55,100,29.5,29.5,25.8,25.8),sf_q:mk(50,50,90,25,41,1,1,5,21,43,54,100,29.5,29.5,20.5,20.5),bl_r:mk(50,44,100,35,41,1,6,21,20,44,55,100,29.5,29.5,22,22),bl_q:mk(50,44,100,30,41,1,6,21,20,44,54,100,29.5,29.5,22,22),bl_i:mk(50,46,100,15,41,1,6,21,20,44,54,100,29.5,29.5,22,22),bl_w:mk(50,46,100,10,41,1,6,21,20,44,54,100,29.5,29.5,22,22),track:{notes:"오버테이킹 어려움.",softLife:"8랩",medLife:"18랩",hardLife:"23랩",pitWindow50:"랩 14-16",strategy:"1스톱. 피트 21초"}},"Zandvoort":{ip_r:mk(42,33,100,25,41,1,5,7,20,40,54,100,28,28,20.5,20.5),ip_q:mk(50,41,100,25,41,10,1,14,20,40,52,100,29,29,24,24),ip_i:mk(50,49,90,25,41,6,9,21,19,48,54,100,29.5,29.5,25.8,25.8),ip_w:mk(50,48,100,20,41,21,1,21,20,40,53,100,27,27,20.5,20.5),es_r:mk(46,41,100,20,41,1,1,5,21,41,53,100,29.5,29.5,25.8,25.8),es_q:mk(46,36,100,25,41,1,1,15,21,41,52,100,29.5,29.5,26.5,26.5),sf_r:mk(46,43,90,30,41,1,1,1,21,42,54,100,29.5,29.5,23.6,23.6),sf_q:mk(46,40,90,30,41,1,1,5,21,42,54,100,29.5,29.5,20.5,20.5),bl_r:mk(38,33,100,30,41,1,4,20,20,43,54,100,29.5,29.5,22,22),bl_q:mk(42,37,100,30,41,1,4,20,20,43,54,100,29.5,29.5,22,22),bl_i:mk(50,44,100,20,41,1,4,20,20,43,54,100,29.5,29.5,22,22),bl_w:mk(50,44,100,20,41,1,4,20,20,43,54,100,29.5,29.5,22,22),track:{notes:"FL 핵심. 2스톱 추천.",softLife:"13랩",medLife:"20랩",hardLife:"27랩",pitWindow50:"랩 10-11&22-23",strategy:"피트 21.5초"}},"Monza":{ip_r:mk(0,0,100,30,41,1,1,16,20,40,54,100,29.5,29.5,26.5,26.5),ip_q:mk(0,0,100,20,41,1,1,21,20,40,53,100,29.5,29.5,26.5,26.5),ip_i:mk(6,3,90,25,41,1,1,21,21,47,54,100,29.5,29.5,25.8,25.8),ip_w:mk(14,8,90,30,41,1,1,20,21,49,54,100,29.5,29.5,25.8,25.8),es_r:mk(0,0,100,30,41,1,1,20,20,40,54,100,29.5,29.5,26.5,26.5),es_q:mk(1,0,100,25,41,1,1,21,20,40,53,100,29.5,29.5,26.5,26.5),sf_r:mk(2,2,90,35,41,1,1,21,20,40,54,100,29.5,29.5,26.5,26.5),sf_q:mk(4,3,90,30,41,1,1,21,20,40,54,100,29.5,29.5,26.5,26.5),bl_r:mk(3,0,100,30,41,1,5,21,21,40,54,100,29.5,29.5,22,22),bl_q:mk(8,0,100,30,41,1,5,21,21,40,54,100,29.5,29.5,20.5,20.5),bl_i:mk(11,2,100,30,41,1,5,21,21,40,54,100,29.5,29.5,22,22),bl_w:mk(20,10,100,30,41,1,5,21,21,40,54,100,29.5,29.5,22,22),track:{notes:"최저 다운포스. 소프트 비추.",softLife:"9랩",medLife:"13랩",hardLife:"18랩",pitWindow50:"랩 9-11",strategy:"1스톱. 피트 21초"}},"Baku":{ip_r:mk(3,0,100,30,41,1,1,8,20,40,55,100,29.5,29.5,20.5,20.5),ip_q:mk(7,0,100,20,41,1,1,20,20,40,53,100,29,29,21,21),ip_i:mk(18,15,90,25,41,1,1,8,20,47,53,100,29.5,29.5,25.8,25.8),ip_w:mk(20,16,100,20,41,1,1,19,19,40,54,100,28,28,20.5,20.5),es_r:mk(5,0,100,25,41,1,1,1,20,40,54,100,29.5,29.5,26.5,26.5),es_q:mk(7,0,100,20,41,1,1,21,20,40,53,100,29.5,29.5,20.5,20.5),sf_r:mk(5,4,90,30,41,1,1,1,22,42,55,100,29.5,29.5,23.6,23.6),sf_q:mk(8,7,90,30,41,1,1,1,22,42,54,100,29.5,29.5,20.5,20.5),bl_r:mk(0,0,100,50,41,1,6,21,20,40,55,100,29.5,29.5,22,22),bl_q:mk(4,0,100,40,41,1,6,21,20,40,55,100,29.5,29.5,22,22),bl_i:mk(12,5,100,40,41,1,6,21,20,40,55,100,29.5,29.5,22,22),bl_w:mk(22,14,100,40,41,1,6,21,20,40,55,100,29.5,29.5,22,22),track:{notes:"리어 마모 최중요.",softLife:"10랩",medLife:"16랩",hardLife:"27랩",pitWindow50:"랩 10-12",strategy:"2스톱. 피트 19.5초"}},"Singapore":{ip_r:mk(50,48,100,30,41,1,1,13,18,40,54,100,29,29,20.5,20.5),ip_q:mk(50,44,100,20,41,1,1,21,18,40,53,100,29,29,20.5,20.5),ip_i:mk(50,50,90,25,41,1,1,10,20,40,53,100,29.5,29.5,25.8,25.8),ip_w:mk(50,50,100,20,40,1,1,20,17,40,54,100,26,26,20.5,20.5),es_r:mk(50,45,100,30,41,1,1,5,20,40,54,100,29.5,29.5,26.5,26.5),es_q:mk(50,45,100,25,41,1,1,10,20,40,53,100,29.5,29.5,20.5,20.5),sf_r:mk(45,50,90,30,41,1,1,1,21,43,55,100,29.5,29.5,26.5,26.5),sf_q:mk(45,50,90,30,41,1,1,5,21,42,54,100,29.5,29.5,20.5,20.5),bl_r:mk(42,42,100,35,40,1,6,21,22,44,54,100,29.5,29.5,22,22),bl_q:mk(44,42,100,30,40,1,6,21,22,44,54,100,29.5,29.5,22,22),bl_i:mk(50,50,100,20,40,1,6,21,22,44,54,100,29.5,29.5,22,22),bl_w:mk(50,50,100,15,40,1,6,21,22,44,54,100,29.5,29.5,22,22),track:{notes:"소프트 불가. M-H.",softLife:"10랩",medLife:"20랩",hardLife:"27랩",pitWindow50:"랩 9-12",strategy:"소프트 금지. 피트 21초"}},"COTA":{ip_r:mk(41,32,100,30,41,1,1,6,19,40,53,100,29.5,29.5,20.5,20.5),ip_q:mk(45,33,100,20,41,1,1,15,19,40,53,100,29.5,29.5,20.5,20.5),ip_i:mk(41,50,90,30,41,13,8,21,21,50,52,100,29.5,29.5,25.8,25.8),ip_w:mk(50,44,100,20,41,1,1,14,18,40,53,100,27,27,20.5,20.5),es_r:mk(35,32,100,30,41,1,1,18,20,40,54,100,29.5,29.5,23.6,23.6),es_q:mk(38,29,100,25,41,1,1,21,20,40,53,100,29.5,29.5,20.5,20.5),sf_r:mk(36,34,90,35,41,1,5,16,20,40,55,100,29.5,29.5,25.5,25.5),sf_q:mk(36,35,90,30,41,1,3,18,20,40,54,100,29.5,29.5,24,24),bl_r:mk(34,30,100,40,40,1,6,21,20,41,55,100,29.5,29.5,22.3,22.3),bl_q:mk(38,34,100,35,40,1,6,21,20,41,54,100,29.5,29.5,22.3,22.3),bl_i:mk(50,48,100,40,40,1,6,21,20,41,54,100,29.5,29.5,22.3,22.3),bl_w:mk(50,48,100,40,40,1,6,21,20,41,54,100,29.5,29.5,22.3,22.3),track:{notes:"섹터1 마모. 미디엄 최고.",softLife:"10랩",medLife:"16랩",hardLife:"23랩",pitWindow50:"랩 8-11",strategy:"미디엄. 피트 19.6초"}},"Mexico":{ip_r:mk(14,9,100,35,41,1,1,14,19,40,55,100,29,29,20.5,20.5),ip_q:mk(40,28,100,25,41,1,1,20,19,40,53,100,29,29,20.5,20.5),ip_i:mk(44,41,90,20,41,7,7,21,20,47,53,100,29.5,29.5,25.8,25.8),ip_w:mk(50,45,100,20,41,1,1,18,18,40,53,100,27,27,20.5,20.5),es_r:mk(22,16,100,25,41,1,1,1,20,40,54,100,29.5,29.5,26.5,26.5),es_q:mk(36,26,100,20,41,1,1,21,20,40,53,100,29.5,29.5,20.5,20.5),sf_r:mk(25,25,90,25,41,1,1,1,20,42,54,100,29.5,29.5,26.5,26.5),sf_q:mk(35,33,90,30,41,1,1,8,20,42,54,100,29.5,29.5,20.5,20.5),bl_r:mk(14,14,100,40,41,1,4,6,20,44,55,100,29.5,29.5,26.5,26.5),bl_q:mk(21,17,100,30,41,1,4,6,20,44,54,100,29.5,29.5,20.5,20.5),bl_i:mk(40,33,100,25,41,1,4,6,20,44,54,100,29.5,29.5,26.5,26.5),bl_w:mk(48,39,100,25,41,1,4,6,20,44,54,100,29.5,29.5,26.5,26.5),track:{notes:"리어 마모 매우 높음.",softLife:"10랩",medLife:"16랩",hardLife:"23랩",pitWindow50:"랩 13-15",strategy:"1스톱. 피트 16초"}},"Brazil":{ip_r:mk(23,17,100,35,41,1,1,13,20,40,54,100,28.5,28.5,22,22),ip_q:mk(32,15,100,20,41,1,1,21,20,40,53,100,29.5,29.5,20.5,20.5),ip_i:mk(41,37,90,25,41,1,8,19,20,47,52,100,29.5,29.5,26.5,26.5),ip_w:mk(48,38,100,20,40,1,1,19,19,40,53,100,28,28,20.5,20.5),es_r:mk(26,22,100,30,41,1,1,15,20,40,53,100,29.5,29.5,26.5,26.5),es_q:mk(28,22,100,20,41,1,1,21,20,40,51,100,29.5,29.5,20.5,20.5),sf_r:mk(24,22,90,30,41,1,1,5,21,41,53,100,29.5,29.5,23.6,23.6),sf_q:mk(25,22,90,30,41,1,1,11,21,41,52,100,29.5,29.5,20.5,20.5),bl_r:mk(11,8,100,30,41,1,5,21,20,44,54,100,29.5,29.5,22,22),bl_q:mk(15,12,100,30,41,1,5,21,20,44,54,100,29.5,29.5,22,22),bl_i:mk(44,40,100,30,41,1,5,21,20,44,54,100,29.5,29.5,22,22),bl_w:mk(50,44,100,30,41,1,5,21,20,44,54,100,29.5,29.5,22,22),track:{notes:"매우 낮은 윙.",softLife:"9랩",medLife:"16랩",hardLife:"20랩",pitWindow50:"랩 13-16",strategy:"1스톱. 피트 19.6초"}},"Vegas":{ip_r:mk(0,0,100,35,36,1,1,12,22,40,55,100,28.5,28.5,24.5,24.5),ip_q:mk(2,0,100,15,38,1,1,21,21,40,53,100,27,27,25.5,25.5),ip_i:mk(0,4,90,30,41,10,8,21,20,46,54,100,23.2,23.2,20.9,20.9),ip_w:mk(0,1,100,15,39,1,1,21,21,40,53,100,26,26,22,22),es_r:mk(0,0,100,30,41,1,1,21,21,41,54,100,29.5,29.5,26.5,26.5),es_q:mk(3,0,100,25,41,1,1,21,21,41,53,100,29.5,29.5,20.6,20.6),sf_r:mk(2,0,90,30,41,1,5,18,22,42,55,100,29.5,29.5,26.5,26.5),sf_q:mk(5,1,90,30,41,1,5,18,22,42,54,100,29.5,29.5,20.5,20.5),bl_r:mk(0,0,100,30,41,1,1,21,22,44,55,100,29.5,29.5,20.5,20.5),bl_q:mk(4,0,100,30,41,1,1,21,22,44,55,100,29.5,29.5,20.5,20.5),bl_i:mk(12,7,100,30,41,1,1,21,22,44,55,100,29.5,29.5,20.5,20.5),bl_w:mk(17,12,100,30,41,1,1,21,22,44,55,100,29.5,29.5,20.5,20.5),track:{notes:"DRS 오버테이킹.",softLife:"9랩",medLife:"16랩",hardLife:"20랩",pitWindow50:"랩 9-10",strategy:"피트 21.5초"}},"Qatar":{ip_r:mk(33,23,100,30,41,1,1,15,20,40,54,100,29.5,29.5,21.5,21.5),ip_q:mk(44,26,100,20,41,1,1,18,20,40,52,100,29.5,29.5,21,21),ip_i:mk(45,42,90,20,41,7,8,20,20,48,53,100,29.5,29.5,25.8,25.8),ip_w:mk(50,38,100,20,41,1,1,20,20,40,52,100,29.5,29.5,21,21),es_r:mk(34,30,100,20,41,1,1,21,20,40,53,100,29.5,29.5,25,25),es_q:mk(36,28,100,20,41,1,1,21,20,40,52,100,29.5,29.5,25,25),sf_r:mk(34,30,100,30,41,1,1,21,20,43,54,100,29.5,29.5,25,25),sf_q:mk(36,30,90,25,41,1,1,21,20,42,53,100,29.5,29.5,25,25),bl_r:mk(44,38,100,30,41,41,6,21,20,40,54,100,29.5,29.5,22,22),bl_q:mk(45,39,100,25,41,41,6,21,20,40,54,100,29.5,29.5,22,22),bl_i:mk(50,44,100,20,41,41,6,21,20,40,54,100,29.5,29.5,22,22),bl_w:mk(50,44,100,20,41,41,6,21,20,40,54,100,29.5,29.5,22,22),track:{notes:"오버테이킹 매우 어려움.",softLife:"9랩",medLife:"13랩",hardLife:"20랩",pitWindow50:"랩 10-14",strategy:"1스톱. 피트 19.9초"}},"Abu Dhabi":{ip_r:mk(19,19,100,25,41,1,1,15,18,40,54,100,28.5,28.5,20.5,20.5),ip_q:mk(32,19,100,20,41,1,1,21,19,40,53,100,29,29,20.5,20.5),ip_i:mk(42,39,90,25,41,4,9,20,20,47,53,100,29.5,29.5,25.8,25.8),ip_w:mk(44,35,100,20,41,1,1,15,18,40,53,100,26.5,26.5,20.5,20.5),es_r:mk(25,18,100,30,41,1,1,10,20,40,54,100,29.5,29.5,25.8,25.8),es_q:mk(35,20,100,20,41,1,1,21,19,40,53,100,29.5,29.5,20.5,20.5),sf_r:mk(25,20,90,30,41,1,1,5,21,42,55,100,29.5,29.5,25.8,25.8),sf_q:mk(35,29,90,25,41,1,1,10,20,41,54,100,29.5,29.5,20.5,20.5),bl_r:mk(32,28,100,30,40,1,3,21,20,40,55,100,29.5,29.5,22,22),bl_q:mk(35,31,100,30,40,1,3,21,20,40,55,100,29.5,29.5,22,22),bl_i:mk(41,35,100,30,40,1,3,21,20,40,55,100,29.5,29.5,22,22),bl_w:mk(46,42,100,30,40,1,3,21,20,40,55,100,29.5,29.5,22,22),track:{notes:"마모 높음. M-H 1스톱.",softLife:"9랩",medLife:"16랩",hardLife:"20랩",pitWindow50:"랩 11-13",strategy:"M-H 1스톱. 피트 19.7초"}}};
// Utility
function gTags(s){const t=[];const aw=(s.fw+s.rw)/2;const at=(s.fl+s.fr+s.rl+s.rr)/4;if(aw>=35)t.push({label:"고다운포스",color:"#7c3aed"});else if(aw>=20)t.push({label:"밸런스",color:"#0891b2"});else t.push({label:"저드래그",color:"#dc2626"});if(s.doff<=20)t.push({label:"날카로운 회전",color:"#ea580c"});else if(s.doff>=40)t.push({label:"리어 안정",color:"#16a34a"});if(s.fs>=38)t.push({label:"단단한 프론트",color:"#ca8a04"});if(s.rs<=3)t.push({label:"소프트 리어",color:"#0284c7"});if(at<=22)t.push({label:"저압 그립",color:"#9333ea"});else if(at>=27)t.push({label:"고압 절약",color:"#15803d"});if(s.bb>=56)t.push({label:"프론트 제동",color:"#b45309"});return t;}
function gCS(s,ti){if(!ti)return null;let sc=70;const aw=(s.fw+s.rw)/2;const at=(s.fl+s.fr+s.rl+s.rr)/4;const ld=ti.drag<0.013;const hw=aw>=30;if(ld&&!hw)sc+=10;if(ld&&hw)sc-=8;if(!ld&&hw)sc+=5;if(ti.aeroF>=3.3&&s.fw<=15)sc+=8;if(ti.aeroF<2.9&&s.fw<=10)sc-=10;if(ti.aeroR>=2.0&&s.doff<=25)sc+=8;if(ti.aeroR<1.85&&s.doff<=20)sc-=8;if(ti.mass>=810&&s.fs>=38)sc+=5;if(ti.mass<=800&&s.fs<=30)sc+=5;if(ti.wDist>=0.2&&s.bb<=54)sc+=7;if(ti.wDist<=0.17&&s.bb>=56)sc+=5;if(ti.wDist>=0.2&&s.bb>=57)sc-=7;if(ti.gear>=1.67&&s.don>=100)sc+=5;if(ti.gear<1.55&&s.don>=100)sc-=5;if(ti.mass>=810&&at<=24)sc+=5;if(ti.mass<=800&&at>=28)sc+=3;return Math.max(0,Math.min(100,Math.round(sc)));}
function gCL(sc){if(sc>=88)return{label:"완벽한 궁합",color:"#22c55e",icon:"*"};if(sc>=76)return{label:"좋은 궁합",color:"#84cc16",icon:"+"};if(sc>=63)return{label:"보통 궁합",color:"#eab308",icon:"~"};if(sc>=50)return{label:"아쉬운 궁합",color:"#f97316",icon:"!"};return{label:"낮은 궁합",color:"#ef4444",icon:"x"};}
function gFeel(s){const aw=(s.fw+s.rw)/2;const at=(s.fl+s.fr+s.rl+s.rr)/4;const f=[];if(aw>=40)f.push("윙 최대");else if(aw>=25)f.push("윙 중상");else if(aw>=10)f.push("윙 낮음");else f.push("윙 최소");if(s.doff<=20)f.push("진입 날카로움");else if(s.doff>=40)f.push("리어 안정형");if(s.rs<=3)f.push("리어 트랙션+");if(s.fs>=38)f.push("프론트 반응+");if(at<=22)f.push("저압 그립+");else if(at>=27)f.push("고압 마모-");return f.join(" / ");}

const KNOWLEDGE_BASE = `[F1 25 셋업 전문 지식 베이스]\n=== 에어로 === 높은 윙=다운포스\u2191 드래그\u2191. 프론트>리어=오버스티어. F1 25는 낮은 에어로+프론트>리어 최적.\n=== 트랜스미션 === 온스로틀 디프: 높음=가속그립\u2191. 오프스로틀: 낮음=회전\u2191.\n=== 서스 === F1 25: 단단한 프론트(41)+소프트 리어(1). ARB로 보상.\n=== 브레이크 === 최적 바이어스 53%. 압력 100%.\n=== 타이어 === 높은 압력이 유리. 이상 온도 85-105C.\n=== Formula Kai === 온스로틀 항상 100. 프론트 서스 41, 리어 1. 프론트 ARB 1.`;

function mk(fw,rw,don,doff,fs,rs,fa,ra,frh,rrh,bb,bp,fl,fr,rl,rr,note=""){return{fw,rw,don,doff,fs,rs,fa,ra,frh,rrh,bb,bp,fl,fr,rl,rr,note};}

async function callClaude(messages, systemPrompt, signal, key?) {
  const k = key || ENV_KEY;
  if (!k) throw new Error("API 키를 설정해주세요");
  const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1024, system: systemPrompt || undefined, messages }), signal });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
}

// ─── Design tokens ───
const P = {
  bg: '#06080d', surface: '#0c1018', surface2: '#121822',
  border: 'rgba(0,229,255,0.08)', borderHi: 'rgba(0,229,255,0.18)',
  accent: '#00e5ff', accent2: '#cdff13', danger: '#ff525c',
  text: '#c8d0da', muted: '#5a6577', dim: '#3a4353',
  mono: "'JetBrains Mono', monospace", sans: "'Plus Jakarta Sans', sans-serif",
};

function Bar({v,min,max}){const p=Math.max(0,Math.min(100,((v-min)/(max-min))*100));const c=p<33?P.accent:p<66?P.accent2:P.danger;return(<div style={{background:'rgba(255,255,255,0.04)',borderRadius:2,height:3,overflow:'hidden'}}><div style={{width:`${p}%`,height:'100%',background:c,borderRadius:2}}/></div>);}

function RC({s1,s2,m1,m2,size=240}){const cx=size/2,cy=size/2,r=size/2-40,n=RK.length;const nm=(k,v)=>{const d=DEFS[k];return(v-d.min)/(d.max-d.min);};const pt=(i,v)=>{const a=(Math.PI*2*i/n)-Math.PI/2;return{x:cx+r*v*Math.cos(a),y:cy+r*v*Math.sin(a)};};const p1=RK.map((k,i)=>pt(i,nm(k.k,s1[k.k])));const p2=s2?RK.map((k,i)=>pt(i,nm(k.k,s2[k.k]))):null;const po=pts=>pts.map(p=>`${p.x},${p.y}`).join(" ");return(<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}><defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>{[0.25,0.5,0.75,1].map(lv=><polygon key={lv} points={po(RK.map((_,i)=>pt(i,lv)))} fill="none" stroke="rgba(0,229,255,0.06)" strokeWidth={1}/>)}{RK.map((_,i)=>{const p=pt(i,1);return<line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(0,229,255,0.04)" strokeWidth={1}/>;})}<polygon points={po(p1)} fill={`${m1?.color||P.accent}20`} stroke={m1?.color||P.accent} strokeWidth={1.5} filter="url(#glow)"/>{p1.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={2.5} fill={m1?.color||P.accent}/>)}{p2&&<><polygon points={po(p2)} fill={`${m2?.color||P.accent2}20`} stroke={m2?.color||P.accent2} strokeWidth={1.5} strokeDasharray="5,3" filter="url(#glow)"/>{p2.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={2.5} fill={m2?.color||P.accent2}/>)}</>}{RK.map((k,i)=>{const p=pt(i,1.18);return<text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill={P.muted} fontSize={8} fontFamily={P.mono} fontWeight={600}>{k.l}</text>;})}</svg>);}

const SORTED_TEAMS = [...TEAMS].sort((a, b) => b.total - a.total);
const MAX_HISTORY = 20;

// ─── SVG Icons ───
const Icons = {
  wrench: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  flag: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>,
  chartBar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  sliders: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
  msgCircle: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  key: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
};

const TABS = [
  { id: "main", label: "SETUP", icon: Icons.wrench },
  { id: "teams", label: "TEAMS", icon: Icons.flag },
  { id: "compare", label: "COMPARE", icon: Icons.chartBar },
  { id: "mysetup", label: "MY SETUP", icon: Icons.sliders },
  { id: "ask", label: "ASK", icon: Icons.msgCircle },
];

function Stepper({ steps, current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '6px 0 10px', overflowX: 'auto' }}>
      {steps.map((s, i) => {
        const done = current > s.n;
        const active = Math.floor(current) === s.n || current === s.n;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 36 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontFamily: P.mono, fontWeight: 700,
                background: done || active ? P.accent : 'transparent',
                border: `1.5px solid ${done || active ? P.accent : P.dim}`,
                color: done || active ? P.bg : P.dim,
              }}>{done ? '\u2713' : s.n}</div>
              <span style={{ fontSize: 8, fontFamily: P.mono, color: active ? P.accent : P.muted, marginTop: 3, whiteSpace: 'nowrap', letterSpacing: 0.5 }}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: done ? P.accent : P.dim, margin: '0 4px', marginBottom: 14, opacity: 0.5 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Chat UI helpers (eliminate 3x JSX repetition) ───
function ChatMessages({ messages, endRef }) {
  return (<>
    {messages.map((m, i) => (
      <div key={i} style={{ display: 'flex', justifyContent: m.r === "u" ? "flex-end" : "flex-start" }}>
        <div style={{
          maxWidth: '85%', padding: '7px 10px', fontSize: 11, lineHeight: 1.6, borderRadius: 3,
          background: m.r === "u" ? 'rgba(0,229,255,0.1)' : P.surface2,
          border: `1px solid ${m.r === "u" ? 'rgba(0,229,255,0.15)' : P.border}`,
          color: P.text, whiteSpace: 'pre-wrap', fontFamily: P.sans,
        }}>{m.t}</div>
      </div>
    ))}
    <div ref={endRef} />
  </>);
}

function ChatLoading({ loading, label = "ANALYZING..." }) {
  if (!loading) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ padding: '7px 12px', borderRadius: 3, fontSize: 10, fontFamily: P.mono, color: P.accent, background: P.surface2, border: `1px solid ${P.border}` }}>{label}</div>
    </div>
  );
}

function ChatChips({ items, onSelect, mb = 8 }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: mb }}>
      {items.map(q => (
        <button key={q} onClick={() => onSelect(q)} style={{
          fontSize: 9, padding: '3px 8px', borderRadius: 2, cursor: 'pointer',
          border: `1px solid ${P.border}`, background: 'transparent', color: P.muted, fontFamily: P.sans,
        }}>{q}</button>
      ))}
    </div>
  );
}

function ChatInput({ value, onChange, onSend, loading, placeholder, buttonLabel = "SEND" }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === "Enter" && onSend()}
        placeholder={placeholder} style={{
          flex: 1, padding: '8px 12px', borderRadius: 3, border: `1px solid ${P.border}`,
          background: P.surface2, color: P.text, fontSize: 11, fontFamily: P.sans, outline: 'none',
        }} />
      <button onClick={onSend} disabled={loading} style={{
        padding: '8px 16px', borderRadius: 3, border: 'none',
        background: loading ? P.dim : P.accent, color: P.bg,
        fontSize: 10, fontFamily: P.mono, fontWeight: 700, letterSpacing: 1,
        cursor: loading ? 'not-allowed' : 'pointer',
      }}>{buttonLabel}</button>
    </div>
  );
}

// ─── Panel component ───
function Panel({ title, children, style: s = {} }) {
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 3, ...s }}>
      {title && (
        <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 2, height: 12, background: P.accent, borderRadius: 1, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontFamily: P.mono, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: P.muted }}>{title}</span>
        </div>
      )}
      <div style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export function F1SetupManager() {
  const [tab, setTab] = useState("main");
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem('frc_api_key') || ENV_KEY || ''; } catch { return ''; } });
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  // Main tab
  const [step, setStep] = useState(1);
  const [track, setTrack] = useState(null);
  const [mode, setMode] = useState(null);
  const [weather, setWeather] = useState(null);
  const [team, setTeam] = useState(null);
  const [selSetup, setSelSetup] = useState(null);
  const [selMeta, setSelMeta] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [fg, setFg] = useState("all");
  const [chat, setChat] = useState([]); const [input, setInput] = useState(""); const [loading, setLoading] = useState(false); const [chatHist, setChatHist] = useState([]);
  // Teams tab
  const [te, setTe] = useState(null);
  // Compare tab
  const [cmpT, setCmpT] = useState(null); const [cmpA, setCmpA] = useState(null); const [cmpB, setCmpB] = useState(null); const [cmpW, setCmpW] = useState("dry");
  // Ask tab
  const [askQ, setAskQ] = useState(""); const [askChat, setAskChat] = useState([]); const [askLoad, setAskLoad] = useState(false); const [askHist, setAskHist] = useState([]);
  // MySetup tab
  const [myTrack, setMyTrack] = useState(null); const [myMode, setMyMode] = useState(null); const [myTeam, setMyTeam] = useState(null);
  const [myVals, setMyVals] = useState(() => { const iv = {}; FIELDS.forEach(f => { const d = DEFS[f.k]; iv[f.k] = Math.round(((d.min + d.max) / 2) * 10) / 10; }); return iv; });
  const [myChat, setMyChat] = useState([]); const [myInput, setMyInput] = useState(""); const [myLoad, setMyLoad] = useState(false); const [myHist, setMyHist] = useState([]);
  const chatEnd = useRef(null); const askRef = useRef(null); const myEnd = useRef(null);

  const useAutoScroll = (ref, dep) => useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth" }); }, [dep]);
  useAutoScroll(chatEnd, chat);
  useAutoScroll(askRef, askChat);
  useAutoScroll(myEnd, myChat);

  const dd = track ? DB[track] : null;
  const ti = TEAMS.find(t => t.name === team);
  const isNE = mode === "nonequal";
  const ts = isNE ? 6 : 5;

  const sTrack = t => { setTrack(t); setMode(null); setWeather(null); setTeam(null); setSelSetup(null); setSelMeta(null); setChat([]); setChatHist([]); setStep(2); };
  const sMode = m => { setMode(m); setWeather(null); setTeam(null); setSelSetup(null); setSelMeta(null); setChat([]); setChatHist([]); setStep(m === "nonequal" ? 2.5 : 3); };
  const sTeam = t => { setTeam(t); setWeather(null); setSelSetup(null); setSelMeta(null); setChat([]); setChatHist([]); setStep(3); };
  const sW = w => { setWeather(w); setSelSetup(null); setSelMeta(null); setChat([]); setChatHist([]); setFg("all"); setStep(4); };
  const sSt = (m, s) => { setSelMeta(m); setSelSetup(s); setChat([]); setChatHist([]); setLoading(false); setStep(5); };

  const bSys = () => { if (!selSetup) return ""; const sw = FIELDS.map(f => `${DEFS[f.k].name}:${selSetup[f.k]}(${DEFS[f.k].min}~${DEFS[f.k].max})`).join("\n"); const ti2 = dd?.track ? `\n[트랙]${track}|${dd.track.notes}\nS:${dd.track.softLife} M:${dd.track.medLife} H:${dd.track.hardLife}\n전략:${dd.track.strategy}` : ""; const tw = ti ? `\n[차량]${ti.name} 장점:${ti.pros} 단점:${ti.cons}` : ""; return `F1 25 셋업 엔지니어. 피드백\u2192셋업 변경.\n\n${KNOWLEDGE_BASE}\n\n[환경]${track}|${isNE ? "논이퀄" : "이퀄"}|${weather === "rain" ? "우천" : "건조"}|${selMeta?.label}${ti2}${tw}\n[셋업]\n${sw}\n[규칙]1.공감+해석 2."항목 현재\u2192추천" 3.이유1줄 4.한국어3~5줄 5.2~3개변경`; };

  // Unified chat send helper
  const chatSend = async (inputVal, guard, sys, setInp, setMsgs, setHist, hist, setLoad) => {
    if (!inputVal.trim() || guard) return;
    const m = inputVal.trim(); setInp("");
    setMsgs(p => [...p, { r: "u", t: m }]);
    const nh = [...hist.slice(-MAX_HISTORY), { role: "user", content: m }];
    setLoad(true);
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 30000);
      const txt = await callClaude(nh, sys, ctrl.signal, apiKey);
      clearTimeout(tid);
      setMsgs(p => [...p, { r: "a", t: txt }]);
      setHist([...nh, { role: "assistant", content: txt }]);
    } catch (e) { setMsgs(p => [...p, { r: "a", t: e.name === "AbortError" ? "TIMEOUT" : "ERR: " + e.message }]); }
    setLoad(false);
  };

  const send = () => chatSend(input, loading, bSys(), setInput, setChat, setChatHist, chatHist, setLoading);
  const askSend = () => chatSend(askQ, askLoad, `F1 25 셋업 전문가. 한국어 3~8줄 답변.\n\n${KNOWLEDGE_BASE}`, setAskQ, setAskChat, setAskHist, askHist, setAskLoad);
  const mySend = () => {
    if (!myTrack) return;
    const sw = FIELDS.map(f => `${DEFS[f.k].name}:${myVals[f.k]}`).join("\n");
    const myTi = TEAMS.find(t => t.name === myTeam);
    const myDD = DB[myTrack];
    const ti2 = myDD?.track ? `\n[트랙]${myTrack}|${myDD.track.notes}` : "";
    const tw = myTi ? `\n[차량]${myTi.name} 장점:${myTi.pros} 단점:${myTi.cons}` : "";
    const sys = `F1 25 셋업 엔지니어. 사용자 커스텀 셋업 분석.\n\n${KNOWLEDGE_BASE}\n\n[환경]${myTrack}${ti2}${tw}\n[사용자 셋업]\n${sw}\n[규칙]한국어3~5줄, 2~3개변경 추천`;
    chatSend(myInput, myLoad, sys, setMyInput, setMyChat, setMyHist, myHist, setMyLoad);
  };

  const fM = SM.filter(m => { const wO = weather === "rain" ? m.rain : !m.rain; const gO = fg === "all" || m.group === fg; return wO && gO; });
  const sortM = useMemo(() => isNE && ti ? [...fM].sort((a, b) => { const sa = dd?.[getDbKey(a)]; const sb = dd?.[getDbKey(b)]; if (!sa || !sb) return 0; return (gCS(sb, ti) || 0) - (gCS(sa, ti) || 0); }) : fM, [fM, dd, ti, isNE]);
  const cD = cmpT ? DB[cmpT] : null; const cSA = cmpA && cD ? cD[getDbKey(SM.find(m => m.key === cmpA) || { key: cmpA })] : null; const cSB = cmpB && cD ? cD[getDbKey(SM.find(m => m.key === cmpB) || { key: cmpB })] : null; const cMA = SM.find(m => m.key === cmpA); const cMB = SM.find(m => m.key === cmpB);

  const qQ = weather === "rain" ? ["비에서 스핀", "비에서 안꺾임", "웻 브레이킹 불안"] : ["리어 미끄러움", "언더스티어", "탑스피드 낮음", "앞바퀴 잠김", "타이어 과열", "코너 탈출 느림"];

  const stepDefs = isNE
    ? [{ n: 1, label: "TRACK" }, { n: 2, label: "MODE" }, { n: 2.5, label: "TEAM" }, { n: 3, label: "WTHR" }, { n: 4, label: "SETUP" }, { n: 5, label: "AI" }]
    : [{ n: 1, label: "TRACK" }, { n: 2, label: "MODE" }, { n: 3, label: "WTHR" }, { n: 4, label: "SETUP" }, { n: 5, label: "AI" }];

  // ─── API Key modal ───
  const handleKeySubmit = () => {
    if (keyInput.trim()) {
      setApiKey(keyInput.trim());
      localStorage.setItem('frc_api_key', keyInput.trim());
    }
    setShowKeyModal(false);
    setKeyInput('');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: P.bg, fontFamily: P.sans }}>
      {/* ═══ Left Sidebar ═══ */}
      <div style={{
        width: 52, minHeight: '100vh', background: P.surface, borderRight: `1px solid ${P.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40, flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} title={t.label} style={{
                width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative',
                color: active ? P.accent : P.muted, borderRadius: 2,
                transition: 'color 0.15s',
              }}>
                {active && <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: P.accent, borderRadius: '0 1px 1px 0' }} />}
                {t.icon}
              </button>
            );
          })}
        </div>
        {/* API Key */}
        <button onClick={() => { setKeyInput(apiKey); setShowKeyModal(true); }} title="API Key" style={{
          width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', cursor: 'pointer', marginBottom: 12,
          color: apiKey ? P.muted : P.danger,
        }}>
          {Icons.key}
        </button>
      </div>

      {/* ═══ Main area ═══ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header bar (32px drag region) */}
        <div style={{
          height: 32, background: P.surface, borderBottom: `1px solid ${P.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
          WebkitAppRegion: 'drag', flexShrink: 0,
        } as any}>
          <span style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: P.text, textTransform: 'uppercase' }}>FRC SETUP LAB</span>
          <span style={{ fontFamily: P.mono, fontSize: 9, letterSpacing: 1.5, color: P.muted, textTransform: 'uppercase' }}>{TABS.find(t => t.id === tab)?.label}</span>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 16px 80px' }}>

          {/* ═══════ SETUP TAB ═══════ */}
          {tab === "main" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Stepper */}
              <Stepper steps={stepDefs} current={step} />

              {/* Step 1: Track */}
              <Panel title="TRACK SELECT">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                  {TD.map(t => {
                    const active = track === t.name;
                    return (
                      <button key={t.name} onClick={() => sTrack(t.name)} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 2,
                        cursor: 'pointer', textAlign: 'left', border: `1px solid ${active ? P.accent : 'transparent'}`,
                        background: active ? 'rgba(0,229,255,0.06)' : 'transparent', transition: 'all 0.15s',
                      }}>
                        <FI flag={t.flag} size={14} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontFamily: P.sans, fontWeight: active ? 700 : 500, color: active ? P.accent : P.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}{t.sprint ? " S" : ""}</div>
                          <div style={{ fontSize: 8, fontFamily: P.mono, color: P.dim }}>R{t.round}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              {/* Step 2: Mode */}
              {step >= 2 && (
                <Panel title="GAME MODE">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[["equal", "EQUAL", "동일 성능"], ["nonequal", "NON-EQUAL", "팀별 차이"]].map(([k, l, d]) => {
                      const active = mode === k;
                      return (
                        <button key={k} onClick={() => sMode(k)} style={{
                          padding: '14px 12px', borderRadius: 3, cursor: 'pointer', textAlign: 'left',
                          border: `1px solid ${active ? P.accent : P.border}`,
                          background: active ? 'rgba(0,229,255,0.06)' : P.surface2, transition: 'all 0.15s',
                        }}>
                          <div style={{ fontSize: 12, fontFamily: P.mono, fontWeight: 700, color: active ? P.accent : P.text, letterSpacing: 1 }}>{l}</div>
                          <div style={{ fontSize: 10, color: P.muted, marginTop: 3 }}>{d}</div>
                        </button>
                      );
                    })}
                  </div>
                </Panel>
              )}

              {/* Step 2.5: Team (nonequal) */}
              {step >= 2.5 && isNE && (
                <Panel title="TEAM SELECT">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {SORTED_TEAMS.map(t => {
                      const active = team === t.name;
                      const pct = (t.total / 55) * 100;
                      return (
                        <button key={t.name} onClick={() => sTeam(t.name)} style={{
                          padding: '10px 12px', borderRadius: 3, cursor: 'pointer', textAlign: 'left',
                          border: `1px solid ${active ? P.accent : P.border}`,
                          background: active ? 'rgba(0,229,255,0.06)' : P.surface2, transition: 'all 0.15s',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: active ? P.accent : P.text }}>{t.name}</span>
                            <span style={{ fontSize: 11, fontFamily: P.mono, fontWeight: 700, color: P.accent2 }}>{t.total}</span>
                          </div>
                          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 2, height: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: active ? P.accent : P.muted, borderRadius: 2, transition: 'width 0.3s' }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Panel>
              )}

              {/* Step 3: Weather */}
              {step >= 3 && (
                <Panel title="WEATHER">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[["dry", "DRY", "슬릭 타이어"], ["rain", "WET", "인터/웻 타이어"]].map(([k, l, d]) => {
                      const active = weather === k;
                      return (
                        <button key={k} onClick={() => sW(k)} style={{
                          padding: '14px 12px', borderRadius: 3, cursor: 'pointer', textAlign: 'center',
                          border: `1px solid ${active ? P.accent : P.border}`,
                          background: active ? 'rgba(0,229,255,0.06)' : P.surface2, transition: 'all 0.15s',
                        }}>
                          <div style={{ fontSize: 20, marginBottom: 4 }}>{k === "dry" ? "\u2600\ufe0f" : "\u{1F327}\ufe0f"}</div>
                          <div style={{ fontSize: 12, fontFamily: P.mono, fontWeight: 700, color: active ? P.accent : P.text, letterSpacing: 1 }}>{l}</div>
                          <div style={{ fontSize: 9, color: P.muted, marginTop: 2 }}>{d}</div>
                        </button>
                      );
                    })}
                  </div>
                </Panel>
              )}

              {/* Step 4: Setup list */}
              {step >= 4 && (
                <Panel title="SETUP SELECT">
                  {dd?.track && (
                    <div style={{ background: P.surface2, borderRadius: 3, padding: '8px 10px', marginBottom: 10, border: `1px solid ${P.border}` }}>
                      <p style={{ fontSize: 10, color: P.muted, margin: '0 0 6px', fontFamily: P.sans }}>{dd.track.notes}</p>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {[["S", dd.track.softLife, P.danger], ["M", dd.track.medLife, P.accent2], ["H", dd.track.hardLife, P.muted]].map(([l, v, c]) => (
                          <span key={l} style={{ fontSize: 9, fontFamily: P.mono, fontWeight: 600, padding: '2px 7px', borderRadius: 2, background: `${c}15`, color: c }}>{l} {v}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {weather === "dry" && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                      {[["all", "ALL"], ["Istvan Puki", "PUKI"], ["Brendon Leigh", "BL"]].map(([k, l]) => (
                        <button key={k} onClick={() => setFg(k)} style={{
                          padding: '4px 10px', borderRadius: 2, fontFamily: P.mono, fontSize: 9, fontWeight: 600, letterSpacing: 1,
                          border: `1px solid ${fg === k ? P.accent : P.border}`,
                          background: fg === k ? P.accent : 'transparent',
                          color: fg === k ? P.bg : P.muted, cursor: 'pointer', transition: 'all 0.15s',
                        }}>{l}</button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sortM.map(meta => {
                      const s = dd?.[getDbKey(meta)]; if (!s) return null;
                      const isExp = !!expanded[meta.key];
                      const isSel = selMeta?.key === meta.key;
                      const tags = gTags(s);
                      const feel = gFeel(s);
                      const cs = isNE && ti ? gCS(s, ti) : null;
                      const cl = cs !== null ? gCL(cs) : null;
                      const fwPct = ((s.fw) / 50) * 100;
                      const rwPct = ((s.rw) / 50) * 100;
                      return (
                        <div key={meta.key} style={{ borderRadius: 3, overflow: 'hidden', border: `1px solid ${isSel ? meta.color : P.border}`, transition: 'border-color 0.2s' }}>
                          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', background: P.surface2, cursor: 'pointer', gap: 10 }} onClick={() => setExpanded(p => ({ ...p, [meta.key]: !p[meta.key] }))}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: isSel ? meta.color : P.text }}>{meta.label}</span>
                                <span style={{ fontSize: 8, fontFamily: P.mono, color: P.dim }}>{meta.who}</span>
                              </div>
                              <div style={{ fontSize: 9, color: P.muted, marginTop: 2 }}>{meta.desc}</div>
                            </div>
                            {/* Mini FW/RW bar */}
                            <div style={{ width: 50, flexShrink: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ fontSize: 7, fontFamily: P.mono, color: P.dim }}>FW</span>
                                <span style={{ fontSize: 7, fontFamily: P.mono, color: P.dim }}>RW</span>
                              </div>
                              <div style={{ display: 'flex', gap: 2 }}>
                                <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 1 }}><div style={{ width: `${fwPct}%`, height: '100%', background: P.accent, borderRadius: 1 }} /></div>
                                <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 1 }}><div style={{ width: `${rwPct}%`, height: '100%', background: P.accent2, borderRadius: 1 }} /></div>
                              </div>
                            </div>
                            <button onClick={e => { e.stopPropagation(); sSt(meta, s); }} style={{
                              fontSize: 9, fontFamily: P.mono, fontWeight: 700, letterSpacing: 1, padding: '5px 10px', borderRadius: 2,
                              border: isSel ? 'none' : `1px solid ${meta.color}40`,
                              background: isSel ? meta.color : 'transparent',
                              color: isSel ? '#000' : meta.color, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                              WebkitAppRegion: 'no-drag',
                            } as any}>SELECT</button>
                          </div>
                          {/* Compatibility */}
                          {cl && (
                            <div style={{ padding: '4px 10px', background: `${cl.color}08`, borderTop: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 9, fontWeight: 600, color: cl.color }}>{cl.icon} {team} {cl.label}</span>
                              <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 1 }}>
                                <div style={{ width: `${cs}%`, height: '100%', background: cl.color, borderRadius: 1 }} />
                              </div>
                              <span style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 800, color: cl.color }}>{cs}</span>
                            </div>
                          )}
                          {/* Tags + Feel */}
                          {(isExp || isSel) && (
                            <div style={{ padding: '6px 10px', borderTop: `1px solid ${P.border}` }}>
                              <div style={{ fontSize: 9, color: P.accent, fontFamily: P.mono, marginBottom: 4, opacity: 0.7 }}>{feel}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {tags.map(tg => (
                                  <span key={tg.label} style={{ fontSize: 8, fontFamily: P.mono, padding: '2px 5px', borderRadius: 2, background: tg.color + '12', color: tg.color, letterSpacing: 0.5 }}>{tg.label}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Expanded detail */}
                          {isExp && (
                            <div style={{ padding: '8px 10px', background: P.surface, borderTop: `1px solid ${P.border}` }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px' }}>
                                {FIELDS.map(f => (
                                  <div key={f.k}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                      <span style={{ fontSize: 8, fontFamily: P.mono, color: P.dim }}>{f.l}</span>
                                      <span style={{ fontSize: 9, fontFamily: P.mono, fontWeight: 700, color: P.accent }}>{s[f.k]}</span>
                                    </div>
                                    <Bar v={s[f.k]} min={DEFS[f.k].min} max={DEFS[f.k].max} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}

              {/* Step 5: AI Chat */}
              {step >= 5 && selSetup && (
                <Panel title="AI FEEDBACK">
                  <div style={{ background: P.surface2, borderRadius: 3, padding: '6px 10px', marginBottom: 10, border: `1px solid ${P.border}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: selMeta?.color, fontFamily: P.sans }}>{selMeta?.label}</div>
                    <div style={{ fontSize: 8, fontFamily: P.mono, color: P.dim, marginTop: 2 }}>{track} / {isNE ? "NON-EQUAL" : "EQUAL"}{team ? ` / ${team}` : ""} / {weather === "rain" ? "WET" : "DRY"}</div>
                  </div>
                  <div style={{ minHeight: 140, maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {chat.length === 0 && <div style={{ textAlign: 'center', color: P.dim, paddingTop: 30, fontSize: 10, fontFamily: P.mono }}>-- 예시를 눌러보거나 입력하세요 --</div>}
                    {chat.map((m, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: m.r === "u" ? "flex-end" : "flex-start" }}>
                        <div style={{
                          maxWidth: '85%', padding: '7px 10px', fontSize: 11, lineHeight: 1.6, borderRadius: 3,
                          background: m.r === "u" ? 'rgba(0,229,255,0.1)' : P.surface2,
                          border: `1px solid ${m.r === "u" ? 'rgba(0,229,255,0.15)' : P.border}`,
                          color: P.text, whiteSpace: 'pre-wrap', fontFamily: m.r === "a" ? P.sans : P.sans,
                        }}>{m.t}</div>
                      </div>
                    ))}
                    {loading && <div style={{ display: 'flex', justifyContent: 'flex-start' }}><div style={{ padding: '7px 12px', borderRadius: 3, fontSize: 10, fontFamily: P.mono, color: P.accent, background: P.surface2, border: `1px solid ${P.border}` }}>ANALYZING...</div></div>}
                    <div ref={chatEnd} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {qQ.map(q => (
                      <button key={q} onClick={() => setInput(q)} style={{
                        fontSize: 9, padding: '3px 8px', borderRadius: 2, cursor: 'pointer',
                        border: `1px solid ${P.border}`, background: 'transparent', color: P.muted,
                        fontFamily: P.sans, transition: 'border-color 0.15s',
                      }}>{q}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="주행 느낌을 입력하세요..." style={{
                      flex: 1, padding: '8px 12px', borderRadius: 3, border: `1px solid ${P.border}`,
                      background: P.surface2, color: P.text, fontSize: 11, fontFamily: P.sans, outline: 'none',
                    }} />
                    <button onClick={send} disabled={loading} style={{
                      padding: '8px 16px', borderRadius: 3, border: 'none',
                      background: loading ? P.dim : P.accent, color: P.bg,
                      fontSize: 10, fontFamily: P.mono, fontWeight: 700, letterSpacing: 1,
                      cursor: loading ? 'not-allowed' : 'pointer',
                    }}>SEND</button>
                  </div>
                </Panel>
              )}
            </div>
          )}

          {/* ═══════ TEAMS TAB ═══════ */}
          {tab === "teams" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SORTED_TEAMS.map((t, i) => {
                const isOpen = te === t.name;
                const pct = (t.total / 55) * 100;
                const stats = [
                  { l: "MASS", v: t.mass, min: 798, max: 813 },
                  { l: "DRAG", v: t.drag, min: 0.01276, max: 0.01497 },
                  { l: "AERO F", v: t.aeroF, min: 2.566, max: 3.368 },
                  { l: "AERO R", v: t.aeroR, min: 1.6412, max: 2.0278 },
                  { l: "GEAR", v: t.gear, min: 1.5133, max: 1.7081 },
                  { l: "W.DIST", v: t.wDist, min: 0.158, max: 0.225 },
                ];
                return (
                  <div key={t.name} onClick={() => setTe(isOpen ? null : t.name)} style={{
                    background: P.surface, borderRadius: 3, border: `1px solid ${isOpen ? P.borderHi : P.border}`,
                    cursor: 'pointer', overflow: 'hidden', transition: 'border-color 0.2s',
                  }}>
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 18, fontFamily: P.mono, fontWeight: 800, color: i === 0 ? P.accent2 : i < 3 ? P.accent : P.dim, minWidth: 28, textAlign: 'right' }}>{i + 1}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: P.text, flex: 1 }}>{t.name}</span>
                        <span style={{ fontSize: 14, fontFamily: P.mono, fontWeight: 800, color: P.accent }}>{t.total}</span>
                      </div>
                      <div style={{ marginLeft: 38 }}>
                        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(to right, ${P.accent}, ${P.accent2})`, borderRadius: 2, transition: 'width 0.4s' }} />
                        </div>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${P.border}`, padding: '10px 12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 10px', marginBottom: 10 }}>
                          {stats.map(st => {
                            const norm = Math.max(0, Math.min(100, ((st.v - st.min) / (st.max - st.min)) * 100));
                            return (
                              <div key={st.l}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                  <span style={{ fontSize: 7, fontFamily: P.mono, color: P.dim, letterSpacing: 0.5 }}>{st.l}</span>
                                  <span style={{ fontSize: 8, fontFamily: P.mono, fontWeight: 700, color: P.accent }}>{st.v}</span>
                                </div>
                                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${norm}%`, height: '100%', background: P.accent, borderRadius: 2, opacity: 0.7 }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div style={{ background: 'rgba(0,229,255,0.04)', borderRadius: 3, padding: '8px 10px', border: `1px solid rgba(0,229,255,0.06)` }}>
                            <div style={{ fontSize: 8, fontFamily: P.mono, fontWeight: 600, color: P.accent, letterSpacing: 1, marginBottom: 4 }}>PROS</div>
                            <p style={{ fontSize: 10, color: P.text, margin: 0, lineHeight: 1.5 }}>{t.pros}</p>
                          </div>
                          <div style={{ background: 'rgba(255,82,92,0.04)', borderRadius: 3, padding: '8px 10px', border: `1px solid rgba(255,82,92,0.06)` }}>
                            <div style={{ fontSize: 8, fontFamily: P.mono, fontWeight: 600, color: P.danger, letterSpacing: 1, marginBottom: 4 }}>CONS</div>
                            <p style={{ fontSize: 10, color: P.text, margin: 0, lineHeight: 1.5 }}>{t.cons}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══════ COMPARE TAB ═══════ */}
          {tab === "compare" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Panel title="SETUP COMPARE">
                {/* Track selector */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, fontFamily: P.mono, color: P.dim, letterSpacing: 1, marginBottom: 6 }}>CIRCUIT</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 3 }}>
                    {TD.map(t => (
                      <button key={t.name} onClick={() => { setCmpT(t.name); setCmpA(null); setCmpB(null); }} style={{
                        padding: '5px 4px', borderRadius: 2, fontSize: 9, fontFamily: P.sans, cursor: 'pointer',
                        border: `1px solid ${cmpT === t.name ? P.accent : 'transparent'}`,
                        background: cmpT === t.name ? 'rgba(0,229,255,0.06)' : P.surface2,
                        color: cmpT === t.name ? P.accent : P.text, transition: 'all 0.15s',
                      }}>{t.name}</button>
                    ))}
                  </div>
                </div>
                {cmpT && cD && (
                  <>
                    {/* Weather */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      {[["dry", "DRY"], ["rain", "WET"]].map(([k, l]) => (
                        <button key={k} onClick={() => { setCmpW(k); setCmpA(null); setCmpB(null); }} style={{
                          padding: '4px 14px', borderRadius: 2, fontFamily: P.mono, fontSize: 9, fontWeight: 600, letterSpacing: 1,
                          border: `1px solid ${cmpW === k ? P.accent : P.border}`,
                          background: cmpW === k ? P.accent : 'transparent',
                          color: cmpW === k ? P.bg : P.muted, cursor: 'pointer',
                        }}>{l}</button>
                      ))}
                    </div>
                    {/* A / B selectors */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {[["A", cmpA, setCmpA, P.accent], ["B", cmpB, setCmpB, P.accent2]].map(([label, val, setVal, col]) => (
                        <div key={label}>
                          <div style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 700, color: col, marginBottom: 6, letterSpacing: 2 }}>SETUP {label}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {SM.filter(m => cmpW === "rain" ? m.rain : !m.rain).map(m => {
                              if (!cD[getDbKey(m)]) return null;
                              return (
                                <button key={m.key} onClick={() => setVal(m.key)} style={{
                                  padding: '4px 8px', borderRadius: 2, textAlign: 'left', fontSize: 9, cursor: 'pointer',
                                  border: `1px solid ${val === m.key ? col : 'transparent'}`,
                                  background: val === m.key ? `${col}10` : 'transparent',
                                  color: val === m.key ? col : P.muted, fontFamily: P.sans, transition: 'all 0.15s',
                                }}>{m.label}</button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Panel>
              {cSA && cSB && (
                <>
                  {/* Radar chart */}
                  <Panel title="RADAR">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 10, fontFamily: P.mono }}>
                        <span style={{ color: cMA?.color }}>{'\u25cf'} {cMA?.label}</span>
                        <span style={{ color: cMB?.color }}>{'\u25c6'} {cMB?.label}</span>
                      </div>
                      <RC s1={cSA} s2={cSB} m1={cMA} m2={cMB} />
                    </div>
                  </Panel>
                  {/* Comparison table */}
                  <Panel title="DETAIL COMPARE">
                    {FIELDS.map(f => {
                      const va = cSA[f.k], vb = cSB[f.k], diff = vb - va;
                      const dc = Math.abs(diff) < 0.5 ? P.dim : diff > 0 ? P.accent2 : P.danger;
                      return (
                        <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: `1px solid ${P.border}` }}>
                          <span style={{ fontSize: 9, fontFamily: P.mono, color: P.dim, minWidth: 80, letterSpacing: 0.5 }}>{f.l}</span>
                          <span style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 700, color: cMA?.color, minWidth: 36, textAlign: 'right' }}>{va}</span>
                          <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 1, position: 'relative' }}>
                            <div style={{
                              position: 'absolute', top: -1, height: 4, borderRadius: 2,
                              background: dc, opacity: 0.6,
                              left: diff >= 0 ? '50%' : `${50 + (diff / (DEFS[f.k].max - DEFS[f.k].min)) * 50}%`,
                              width: `${Math.abs(diff / (DEFS[f.k].max - DEFS[f.k].min)) * 50}%`,
                            }} />
                          </div>
                          <span style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 700, color: cMB?.color, minWidth: 36, textAlign: 'right' }}>{vb}</span>
                          <span style={{ fontSize: 9, fontFamily: P.mono, fontWeight: 700, color: dc, minWidth: 36, textAlign: 'right' }}>{diff > 0 ? "+" : ""}{diff !== 0 ? diff.toFixed(1) : "-"}</span>
                        </div>
                      );
                    })}
                  </Panel>
                </>
              )}
            </div>
          )}

          {/* ═══════ MY SETUP TAB ═══════ */}
          {tab === "mysetup" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Panel title="CIRCUIT">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 3 }}>
                  {TD.map(t => (
                    <button key={t.name} onClick={() => { setMyTrack(t.name); setMyChat([]); setMyHist([]); }} style={{
                      padding: '5px 4px', borderRadius: 2, fontSize: 9, cursor: 'pointer',
                      border: `1px solid ${myTrack === t.name ? P.accent : 'transparent'}`,
                      background: myTrack === t.name ? 'rgba(0,229,255,0.06)' : P.surface2,
                      color: myTrack === t.name ? P.accent : P.text, fontFamily: P.sans, transition: 'all 0.15s',
                    }}>{t.name}</button>
                  ))}
                </div>
              </Panel>

              <Panel title="PARAMETERS">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                  {FIELDS.map(f => {
                    const d = DEFS[f.k];
                    const v = myVals[f.k];
                    const sc = d.min % 1 !== 0 || d.max % 1 !== 0 ? 0.5 : 1;
                    return (
                      <div key={f.k}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 9, fontFamily: P.mono, color: P.muted, letterSpacing: 0.5 }}>{f.l}</span>
                          <span style={{ fontSize: 11, fontFamily: P.mono, fontWeight: 700, color: P.accent }}>{v}</span>
                        </div>
                        <input type="range" min={d.min} max={d.max} step={sc} value={v}
                          onChange={e => setMyVals(pv => ({ ...pv, [f.k]: parseFloat(e.target.value) }))}
                          style={{ width: '100%', height: 3 }} />
                      </div>
                    );
                  })}
                </div>
              </Panel>

              {myTrack && (
                <Panel title="AI ANALYSIS">
                  <div style={{ minHeight: 140, maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {myChat.length === 0 && <div style={{ textAlign: 'center', color: P.dim, paddingTop: 30, fontSize: 10, fontFamily: P.mono }}>-- 아래 예시를 누르거나 질문하세요 --</div>}
                    {myChat.map((m, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: m.r === "u" ? "flex-end" : "flex-start" }}>
                        <div style={{
                          maxWidth: '85%', padding: '7px 10px', fontSize: 11, lineHeight: 1.6, borderRadius: 3,
                          background: m.r === "u" ? 'rgba(0,229,255,0.1)' : P.surface2,
                          border: `1px solid ${m.r === "u" ? 'rgba(0,229,255,0.15)' : P.border}`,
                          color: P.text, whiteSpace: 'pre-wrap',
                        }}>{m.t}</div>
                      </div>
                    ))}
                    {myLoad && <div style={{ display: 'flex', justifyContent: 'flex-start' }}><div style={{ padding: '7px 12px', borderRadius: 3, fontSize: 10, fontFamily: P.mono, color: P.accent, background: P.surface2, border: `1px solid ${P.border}` }}>ANALYZING...</div></div>}
                    <div ref={myEnd} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                    {["이 셋업 어때?", "언더스티어 생길까?", "직선 속도는?", "타이어 마모 어떨까?"].map(q => (
                      <button key={q} onClick={() => setMyInput(q)} style={{
                        fontSize: 9, padding: '3px 8px', borderRadius: 2, cursor: 'pointer',
                        border: `1px solid ${P.border}`, background: 'transparent',
                        color: P.muted, fontFamily: P.sans,
                      }}>{q}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={myInput} onChange={e => setMyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && mySend()} placeholder="셋업에 대해 질문하세요..." style={{
                      flex: 1, padding: '8px 12px', borderRadius: 3, border: `1px solid ${P.border}`,
                      background: P.surface2, color: P.text, fontSize: 11, fontFamily: P.sans, outline: 'none',
                    }} />
                    <button onClick={mySend} disabled={myLoad} style={{
                      padding: '8px 16px', borderRadius: 3, border: 'none',
                      background: myLoad ? P.dim : P.accent, color: P.bg,
                      fontSize: 10, fontFamily: P.mono, fontWeight: 700, letterSpacing: 1,
                      cursor: myLoad ? 'not-allowed' : 'pointer',
                    }}>ANALYZE</button>
                  </div>
                </Panel>
              )}
            </div>
          )}

          {/* ═══════ ASK TAB ═══════ */}
          {tab === "ask" && (
            <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
              {/* Suggested chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                {["프론트 윙 올리면?", "오프스로틀 디프가 뭔가요?", "브레이크 바이어스?", "타이어 압력 높으면?", "리어 안티롤바 역할?"].map(q => (
                  <button key={q} onClick={() => setAskQ(q)} style={{
                    fontSize: 9, padding: '4px 10px', borderRadius: 2, cursor: 'pointer',
                    border: `1px solid ${P.border}`, background: 'transparent', color: P.muted,
                    fontFamily: P.sans, transition: 'border-color 0.15s',
                  }}>{q}</button>
                ))}
              </div>
              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, minHeight: 0 }}>
                {askChat.length === 0 && (
                  <div style={{ textAlign: 'center', color: P.dim, paddingTop: 60, fontFamily: P.mono, fontSize: 10 }}>
                    <div style={{ fontSize: 11, marginBottom: 6, letterSpacing: 2 }}>SETUP Q&A</div>
                    <div>SimRacingSetups + Traxion 기반 답변</div>
                  </div>
                )}
                {askChat.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.r === "u" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: '85%', padding: '8px 11px', fontSize: 11, lineHeight: 1.7, borderRadius: 3,
                      background: m.r === "u" ? 'rgba(0,229,255,0.1)' : P.surface,
                      border: `1px solid ${m.r === "u" ? 'rgba(0,229,255,0.15)' : P.border}`,
                      color: P.text, whiteSpace: 'pre-wrap',
                    }}>{m.t}</div>
                  </div>
                ))}
                {askLoad && <div style={{ display: 'flex', justifyContent: 'flex-start' }}><div style={{ padding: '7px 12px', borderRadius: 3, fontSize: 10, fontFamily: P.mono, color: P.accent, background: P.surface, border: `1px solid ${P.border}` }}>GENERATING...</div></div>}
                <div ref={askRef} />
              </div>
              {/* Input bar */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <input value={askQ} onChange={e => setAskQ(e.target.value)} onKeyDown={e => e.key === "Enter" && askSend()} placeholder="셋업에 대해 질문하세요..." style={{
                  flex: 1, padding: '8px 12px', borderRadius: 3, border: `1px solid ${P.border}`,
                  background: P.surface, color: P.text, fontSize: 11, fontFamily: P.sans, outline: 'none',
                }} />
                <button onClick={askSend} disabled={askLoad} style={{
                  padding: '8px 16px', borderRadius: 3, border: 'none',
                  background: askLoad ? P.dim : P.accent, color: P.bg,
                  fontSize: 10, fontFamily: P.mono, fontWeight: 700, letterSpacing: 1,
                  cursor: askLoad ? 'not-allowed' : 'pointer',
                }}>ASK</button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ═══ API Key Modal ═══ */}
      {showKeyModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setShowKeyModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: P.surface, border: `1px solid ${P.border}`, borderRadius: 3, padding: 20, width: 340, maxWidth: '90%',
          }}>
            <div style={{ fontSize: 11, fontFamily: P.mono, fontWeight: 600, letterSpacing: 2, color: P.muted, marginBottom: 14 }}>API KEY</div>
            <input value={keyInput} onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleKeySubmit()}
              placeholder="sk-ant-..." style={{
                width: '100%', padding: '8px 12px', borderRadius: 3, border: `1px solid ${P.border}`,
                background: P.surface2, color: P.text, fontSize: 11, fontFamily: P.mono, outline: 'none', marginBottom: 12,
              }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowKeyModal(false)} style={{
                padding: '6px 14px', borderRadius: 3, border: `1px solid ${P.border}`, background: 'transparent',
                color: P.muted, fontSize: 10, fontFamily: P.mono, cursor: 'pointer',
              }}>CANCEL</button>
              <button onClick={handleKeySubmit} style={{
                padding: '6px 14px', borderRadius: 3, border: 'none', background: P.accent,
                color: P.bg, fontSize: 10, fontFamily: P.mono, fontWeight: 700, cursor: 'pointer',
              }}>SAVE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
