// GENERATED FILE — do not edit; regenerate: node scripts/fetch-track-corners.mjs
// Source: https://api.multiviewer.app/api/v1/circuits/{circuitKey}/{year} (requested year 2025; per-track returned vintage below).
// pct = 코너 apex 의 랩 대비 비율(스타트라인 기준) — 런타임에 session.trackLength(m)를 곱해 사용.
// 리버스 트랙(39-41)·Madring(42)은 공식 코너 데이터가 존재하지 않아 의도적으로 부재 (fabrication 금지).

export interface TrackCornerPct {
  /** 공식 코너 번호 (이중 apex 는 같은 번호가 연속 등장할 수 있음). */
  n: number;
  /** 랩 대비 비율 (0,1) 개구간, 오름차순. */
  pct: number;
}

/** canonical trackId → 코너 apex 목록 (랩 비율 오름차순). */
export const TRACK_CORNER_PCTS: Record<number, readonly TrackCornerPct[]> = {
  // trackId 0 · Melbourne · circuitKey 10 · MultiViewer year 2022
  0: [{ n: 1, pct: 0.068 }, { n: 2, pct: 0.0834 }, { n: 3, pct: 0.206 }, { n: 4, pct: 0.2353 }, { n: 5, pct: 0.2734 }, { n: 6, pct: 0.355 }, { n: 7, pct: 0.3761 }, { n: 8, pct: 0.4148 }, { n: 9, pct: 0.6263 }, { n: 10, pct: 0.648 }, { n: 11, pct: 0.782 }, { n: 12, pct: 0.8321 }, { n: 13, pct: 0.8789 }, { n: 14, pct: 0.9101 }],
  // trackId 2 · Shanghai · circuitKey 49 · MultiViewer year 2019
  2: [{ n: 1, pct: 0.1055 }, { n: 2, pct: 0.1394 }, { n: 3, pct: 0.1675 }, { n: 4, pct: 0.1923 }, { n: 5, pct: 0.2477 }, { n: 6, pct: 0.2944 }, { n: 7, pct: 0.3792 }, { n: 8, pct: 0.434 }, { n: 9, pct: 0.4691 }, { n: 10, pct: 0.4904 }, { n: 11, pct: 0.5781 }, { n: 12, pct: 0.5937 }, { n: 13, pct: 0.6311 }, { n: 14, pct: 0.8822 }, { n: 15, pct: 0.8972 }, { n: 16, pct: 0.9516 }],
  // trackId 3 · Sakhir · circuitKey 63 · MultiViewer year 2022
  3: [{ n: 1, pct: 0.1323 }, { n: 2, pct: 0.1499 }, { n: 3, pct: 0.1709 }, { n: 4, pct: 0.2805 }, { n: 5, pct: 0.33 }, { n: 6, pct: 0.3476 }, { n: 7, pct: 0.3647 }, { n: 8, pct: 0.4129 }, { n: 9, pct: 0.4805 }, { n: 10, pct: 0.4985 }, { n: 11, pct: 0.6433 }, { n: 12, pct: 0.7175 }, { n: 13, pct: 0.7584 }, { n: 14, pct: 0.9091 }, { n: 15, pct: 0.9243 }],
  // trackId 4 · Catalunya · circuitKey 15 · MultiViewer year 2023
  4: [{ n: 1, pct: 0.1766 }, { n: 2, pct: 0.1943 }, { n: 3, pct: 0.2491 }, { n: 4, pct: 0.3724 }, { n: 5, pct: 0.4674 }, { n: 6, pct: 0.5075 }, { n: 7, pct: 0.5446 }, { n: 8, pct: 0.5644 }, { n: 9, pct: 0.6225 }, { n: 10, pct: 0.7518 }, { n: 11, pct: 0.7842 }, { n: 12, pct: 0.8074 }, { n: 13, pct: 0.8677 }, { n: 14, pct: 0.9346 }],
  // trackId 5 · Monte Carlo · circuitKey 22 · MultiViewer year 2022
  5: [{ n: 1, pct: 0.0594 }, { n: 2, pct: 0.1787 }, { n: 3, pct: 0.2292 }, { n: 4, pct: 0.2675 }, { n: 5, pct: 0.3367 }, { n: 6, pct: 0.3732 }, { n: 7, pct: 0.3974 }, { n: 8, pct: 0.4238 }, { n: 9, pct: 0.5253 }, { n: 10, pct: 0.6253 }, { n: 11, pct: 0.6413 }, { n: 12, pct: 0.711 }, { n: 13, pct: 0.7577 }, { n: 14, pct: 0.7668 }, { n: 15, pct: 0.8078 }, { n: 16, pct: 0.8143 }, { n: 17, pct: 0.8368 }, { n: 18, pct: 0.8726 }, { n: 19, pct: 0.9005 }],
  // trackId 6 · Montreal · circuitKey 23 · MultiViewer year 2022
  6: [{ n: 1, pct: 0.052 }, { n: 2, pct: 0.0757 }, { n: 3, pct: 0.1628 }, { n: 4, pct: 0.176 }, { n: 5, pct: 0.2278 }, { n: 6, pct: 0.2792 }, { n: 7, pct: 0.2994 }, { n: 8, pct: 0.457 }, { n: 9, pct: 0.4757 }, { n: 10, pct: 0.6138 }, { n: 11, pct: 0.6382 }, { n: 12, pct: 0.7233 }, { n: 13, pct: 0.8893 }, { n: 14, pct: 0.8968 }],
  // trackId 7 · Silverstone · circuitKey 2 · MultiViewer year 2022
  7: [{ n: 1, pct: 0.0775 }, { n: 2, pct: 0.1047 }, { n: 3, pct: 0.1486 }, { n: 4, pct: 0.1778 }, { n: 5, pct: 0.2106 }, { n: 6, pct: 0.3364 }, { n: 7, pct: 0.374 }, { n: 8, pct: 0.4329 }, { n: 9, pct: 0.5229 }, { n: 10, pct: 0.6175 }, { n: 11, pct: 0.6332 }, { n: 12, pct: 0.658 }, { n: 13, pct: 0.6822 }, { n: 14, pct: 0.7073 }, { n: 15, pct: 0.8551 }, { n: 16, pct: 0.9324 }, { n: 17, pct: 0.9478 }, { n: 18, pct: 0.9735 }],
  // trackId 8 · Hungaroring · circuitKey 4 · MultiViewer year 2021
  8: [{ n: 1, pct: 0.1484 }, { n: 1, pct: 0.1912 }, { n: 2, pct: 0.2634 }, { n: 3, pct: 0.3051 }, { n: 4, pct: 0.4147 }, { n: 5, pct: 0.4703 }, { n: 6, pct: 0.5474 }, { n: 7, pct: 0.5573 }, { n: 8, pct: 0.5957 }, { n: 9, pct: 0.6278 }, { n: 10, pct: 0.6725 }, { n: 11, pct: 0.7182 }, { n: 12, pct: 0.8091 }, { n: 12, pct: 0.8385 }, { n: 13, pct: 0.8704 }, { n: 14, pct: 0.9373 }],
  // trackId 9 · Spa-Francorchamps · circuitKey 7 · MultiViewer year 2021
  9: [{ n: 1, pct: 0.0549 }, { n: 2, pct: 0.1524 }, { n: 3, pct: 0.1687 }, { n: 4, pct: 0.1828 }, { n: 5, pct: 0.3456 }, { n: 6, pct: 0.3569 }, { n: 7, pct: 0.3806 }, { n: 8, pct: 0.4369 }, { n: 9, pct: 0.4717 }, { n: 10, pct: 0.5458 }, { n: 11, pct: 0.5813 }, { n: 12, pct: 0.6418 }, { n: 13, pct: 0.6645 }, { n: 14, pct: 0.707 }, { n: 15, pct: 0.7429 }, { n: 16, pct: 0.8464 }, { n: 17, pct: 0.8858 }, { n: 18, pct: 0.963 }, { n: 19, pct: 0.9726 }],
  // trackId 10 · Monza · circuitKey 39 · MultiViewer year 2021
  10: [{ n: 1, pct: 0.1573 }, { n: 2, pct: 0.1672 }, { n: 3, pct: 0.2564 }, { n: 4, pct: 0.3686 }, { n: 5, pct: 0.3776 }, { n: 6, pct: 0.44 }, { n: 7, pct: 0.4954 }, { n: 8, pct: 0.681 }, { n: 9, pct: 0.6968 }, { n: 10, pct: 0.7145 }, { n: 11, pct: 0.9031 }],
  // trackId 11 · Singapore · circuitKey 61 · MultiViewer year 2023
  11: [{ n: 1, pct: 0.0824 }, { n: 2, pct: 0.0965 }, { n: 3, pct: 0.111 }, { n: 4, pct: 0.1421 }, { n: 5, pct: 0.1972 }, { n: 6, pct: 0.2848 }, { n: 7, pct: 0.362 }, { n: 8, pct: 0.4091 }, { n: 9, pct: 0.4479 }, { n: 10, pct: 0.5345 }, { n: 11, pct: 0.5677 }, { n: 12, pct: 0.5844 }, { n: 13, pct: 0.6188 }, { n: 14, pct: 0.7345 }, { n: 15, pct: 0.78 }, { n: 16, pct: 0.8807 }, { n: 17, pct: 0.8961 }, { n: 18, pct: 0.9506 }, { n: 19, pct: 0.9749 }],
  // trackId 12 · Suzuka · circuitKey 46 · MultiViewer year 2025
  12: [{ n: 1, pct: 0.1219 }, { n: 2, pct: 0.1423 }, { n: 3, pct: 0.1851 }, { n: 4, pct: 0.2078 }, { n: 5, pct: 0.2345 }, { n: 6, pct: 0.2629 }, { n: 7, pct: 0.3204 }, { n: 8, pct: 0.3921 }, { n: 9, pct: 0.4191 }, { n: 10, pct: 0.4739 }, { n: 11, pct: 0.5006 }, { n: 12, pct: 0.5444 }, { n: 13, pct: 0.6546 }, { n: 14, pct: 0.6816 }, { n: 15, pct: 0.8619 }, { n: 16, pct: 0.9302 }, { n: 17, pct: 0.9427 }, { n: 18, pct: 0.9714 }],
  // trackId 13 · Yas Marina · circuitKey 70 · MultiViewer year 2021
  13: [{ n: 1, pct: 0.0743 }, { n: 2, pct: 0.1207 }, { n: 3, pct: 0.1606 }, { n: 4, pct: 0.1975 }, { n: 5, pct: 0.2724 }, { n: 6, pct: 0.5018 }, { n: 7, pct: 0.5133 }, { n: 8, pct: 0.5518 }, { n: 9, pct: 0.7081 }, { n: 10, pct: 0.7725 }, { n: 11, pct: 0.8031 }, { n: 12, pct: 0.828 }, { n: 13, pct: 0.8488 }, { n: 14, pct: 0.8721 }, { n: 15, pct: 0.9232 }, { n: 16, pct: 0.9674 }],
  // trackId 14 · Austin · circuitKey 9 · MultiViewer year 2021
  14: [{ n: 1, pct: 0.1183 }, { n: 2, pct: 0.1631 }, { n: 3, pct: 0.2114 }, { n: 4, pct: 0.2274 }, { n: 5, pct: 0.2456 }, { n: 6, pct: 0.2699 }, { n: 7, pct: 0.312 }, { n: 8, pct: 0.3403 }, { n: 9, pct: 0.3574 }, { n: 10, pct: 0.396 }, { n: 11, pct: 0.4664 }, { n: 12, pct: 0.6857 }, { n: 13, pct: 0.7287 }, { n: 14, pct: 0.7421 }, { n: 15, pct: 0.7793 }, { n: 16, pct: 0.8137 }, { n: 17, pct: 0.8384 }, { n: 18, pct: 0.8639 }, { n: 19, pct: 0.9157 }, { n: 20, pct: 0.9719 }],
  // trackId 16 · Interlagos · circuitKey 14 · MultiViewer year 2023
  16: [{ n: 1, pct: 0.0821 }, { n: 2, pct: 0.1054 }, { n: 3, pct: 0.1497 }, { n: 4, pct: 0.3289 }, { n: 5, pct: 0.3675 }, { n: 6, pct: 0.472 }, { n: 7, pct: 0.5047 }, { n: 8, pct: 0.543 }, { n: 9, pct: 0.5729 }, { n: 10, pct: 0.6424 }, { n: 11, pct: 0.692 }, { n: 12, pct: 0.7613 }, { n: 13, pct: 0.7877 }, { n: 14, pct: 0.8491 }, { n: 15, pct: 0.9443 }],
  // trackId 17 · Spielberg · circuitKey 19 · MultiViewer year 2022
  17: [{ n: 1, pct: 0.1004 }, { n: 2, pct: 0.2486 }, { n: 3, pct: 0.3186 }, { n: 4, pct: 0.5084 }, { n: 5, pct: 0.5523 }, { n: 6, pct: 0.6288 }, { n: 7, pct: 0.7034 }, { n: 8, pct: 0.7503 }, { n: 9, pct: 0.8751 }, { n: 10, pct: 0.9193 }],
  // trackId 19 · Mexico City · circuitKey 65 · MultiViewer year 2021
  19: [{ n: 1, pct: 0.2839 }, { n: 2, pct: 0.3011 }, { n: 3, pct: 0.3154 }, { n: 4, pct: 0.4792 }, { n: 5, pct: 0.4957 }, { n: 6, pct: 0.5277 }, { n: 7, pct: 0.6064 }, { n: 8, pct: 0.6332 }, { n: 9, pct: 0.6509 }, { n: 10, pct: 0.6947 }, { n: 11, pct: 0.7188 }, { n: 12, pct: 0.85 }, { n: 13, pct: 0.8921 }, { n: 14, pct: 0.9074 }, { n: 15, pct: 0.9178 }, { n: 16, pct: 0.933 }, { n: 17, pct: 0.9616 }],
  // trackId 20 · Baku · circuitKey 144 · MultiViewer year 2022
  20: [{ n: 1, pct: 0.0496 }, { n: 2, pct: 0.1064 }, { n: 3, pct: 0.2509 }, { n: 4, pct: 0.2885 }, { n: 5, pct: 0.3448 }, { n: 6, pct: 0.3545 }, { n: 7, pct: 0.4193 }, { n: 8, pct: 0.4525 }, { n: 9, pct: 0.4569 }, { n: 10, pct: 0.4618 }, { n: 11, pct: 0.4697 }, { n: 12, pct: 0.4793 }, { n: 13, pct: 0.5466 }, { n: 14, pct: 0.5847 }, { n: 15, pct: 0.622 }, { n: 16, pct: 0.6821 }, { n: 17, pct: 0.7139 }, { n: 18, pct: 0.7538 }, { n: 19, pct: 0.7797 }, { n: 20, pct: 0.8321 }],
  // trackId 23 · Zandvoort · circuitKey 55 · MultiViewer year 2021
  23: [{ n: 1, pct: 0.0856 }, { n: 2, pct: 0.1581 }, { n: 3, pct: 0.1971 }, { n: 4, pct: 0.2476 }, { n: 5, pct: 0.2915 }, { n: 6, pct: 0.3294 }, { n: 7, pct: 0.4007 }, { n: 8, pct: 0.476 }, { n: 9, pct: 0.5275 }, { n: 10, pct: 0.5887 }, { n: 11, pct: 0.7267 }, { n: 12, pct: 0.7474 }, { n: 13, pct: 0.8196 }, { n: 14, pct: 0.886 }],
  // trackId 24 · Imola · circuitKey 6 · MultiViewer year 2022
  24: [{ n: 1, pct: 0.0522 }, { n: 2, pct: 0.1817 }, { n: 3, pct: 0.1944 }, { n: 4, pct: 0.2235 }, { n: 5, pct: 0.3121 }, { n: 6, pct: 0.3319 }, { n: 7, pct: 0.3889 }, { n: 8, pct: 0.4708 }, { n: 9, pct: 0.5216 }, { n: 10, pct: 0.5493 }, { n: 11, pct: 0.6007 }, { n: 12, pct: 0.6201 }, { n: 13, pct: 0.6372 }, { n: 14, pct: 0.7222 }, { n: 15, pct: 0.7322 }, { n: 16, pct: 0.8454 }, { n: 17, pct: 0.8854 }, { n: 18, pct: 0.9142 }, { n: 19, pct: 0.9778 }],
  // trackId 25 · Jeddah · circuitKey 149 · MultiViewer year 2022
  25: [{ n: 1, pct: 0.0793 }, { n: 2, pct: 0.089 }, { n: 3, pct: 0.1119 }, { n: 4, pct: 0.1615 }, { n: 5, pct: 0.1788 }, { n: 6, pct: 0.2039 }, { n: 7, pct: 0.2229 }, { n: 8, pct: 0.2351 }, { n: 9, pct: 0.2606 }, { n: 10, pct: 0.2774 }, { n: 11, pct: 0.294 }, { n: 12, pct: 0.3084 }, { n: 13, pct: 0.3948 }, { n: 14, pct: 0.447 }, { n: 15, pct: 0.4804 }, { n: 16, pct: 0.5015 }, { n: 17, pct: 0.518 }, { n: 18, pct: 0.5546 }, { n: 19, pct: 0.5869 }, { n: 20, pct: 0.6209 }, { n: 21, pct: 0.6538 }, { n: 22, pct: 0.6936 }, { n: 23, pct: 0.7082 }, { n: 24, pct: 0.7316 }, { n: 25, pct: 0.7792 }, { n: 26, pct: 0.8384 }, { n: 27, pct: 0.9016 }],
  // trackId 26 · Miami · circuitKey 151 · MultiViewer year 2022
  26: [{ n: 1, pct: 0.0708 }, { n: 2, pct: 0.0902 }, { n: 3, pct: 0.1073 }, { n: 4, pct: 0.2131 }, { n: 5, pct: 0.239 }, { n: 6, pct: 0.2667 }, { n: 7, pct: 0.2925 }, { n: 8, pct: 0.3111 }, { n: 9, pct: 0.4093 }, { n: 10, pct: 0.4616 }, { n: 11, pct: 0.581 }, { n: 12, pct: 0.6021 }, { n: 13, pct: 0.6263 }, { n: 14, pct: 0.6403 }, { n: 15, pct: 0.6439 }, { n: 16, pct: 0.6608 }, { n: 17, pct: 0.907 }, { n: 18, pct: 0.933 }, { n: 19, pct: 0.9719 }],
  // trackId 27 · Losail · circuitKey 150 · MultiViewer year 2023
  27: [{ n: 1, pct: 0.1483 }, { n: 2, pct: 0.2023 }, { n: 3, pct: 0.2437 }, { n: 4, pct: 0.3218 }, { n: 5, pct: 0.3509 }, { n: 6, pct: 0.4089 }, { n: 7, pct: 0.4826 }, { n: 8, pct: 0.5182 }, { n: 9, pct: 0.5407 }, { n: 10, pct: 0.5838 }, { n: 11, pct: 0.6418 }, { n: 12, pct: 0.6988 }, { n: 13, pct: 0.7362 }, { n: 14, pct: 0.7743 }, { n: 15, pct: 0.829 }, { n: 16, pct: 0.9173 }],
  // trackId 28 · Las Vegas · circuitKey 152 · MultiViewer year 2023
  28: [{ n: 1, pct: 0.0454 }, { n: 2, pct: 0.061 }, { n: 3, pct: 0.0917 }, { n: 4, pct: 0.1115 }, { n: 5, pct: 0.2512 }, { n: 6, pct: 0.2941 }, { n: 7, pct: 0.3299 }, { n: 8, pct: 0.3386 }, { n: 9, pct: 0.3593 }, { n: 10, pct: 0.439 }, { n: 11, pct: 0.4821 }, { n: 12, pct: 0.5196 }, { n: 13, pct: 0.6439 }, { n: 14, pct: 0.836 }, { n: 15, pct: 0.8458 }, { n: 16, pct: 0.8555 }, { n: 17, pct: 0.9782 }],
};
