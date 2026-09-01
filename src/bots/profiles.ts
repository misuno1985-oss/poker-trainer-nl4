/**
 * Двадцать соперников из реальной базы (7667 раздач на 1win, август 2026).
 * Файл собран инструментом gen_profiles.py — руками не править.
 *
 * Каждая частота получена так: если выборка большая, берётся измеренное
 * значение; если маленькая — оно подтягивается к среднему по своему архетипу
 * с весом n/(n+40). Поэтому игрок со 128 раздачами не получает выдуманную
 * точность, но и не теряет то, что в его игре действительно видно.
 *
 * `samples` хранит размеры выборок — по ним тренер решает, насколько уверенно
 * можно говорить о конкретной наклонности этого соперника.
 *
 * ВАЖНО про постфлоп: c-bet и особенно рейзы на ривере измерены на десятках
 * случаев, а не сотнях. Направление им верить можно, точной цифре — нет.
 */

import type { Position } from '../game/types';

export type Archetype =
  | 'tight-aggressive'
  | 'tight-passive'
  | 'loose-aggressive'
  | 'loose-passive';

export interface StreetStats {
  /** Как часто ставит, когда ход первый и никто ещё не ставил. */
  betFirst: number;
  foldVsBet: number;
  callVsBet: number;
  raiseVsBet: number;
  /** Медианный размер ставки в долях банка. */
  sizePct: number;
}

export interface ProfileSamples {
  open: number; threeBet: number; vs3bet: number; flops: number;
  cbet: number; flopVsBet: number; turnVsBet: number; riverVsBet: number;
}

export interface BotProfile {
  name: string;
  /** Сколько раздач этого игрока есть в базе. */
  hands: number;
  archetype: Archetype;
  vpip: number;
  pfr: number;
  /** Частота открытия рейзом по позициям. */
  openBy: Record<Position, number>;
  openSizeBB: number;
  /** Частота лимпа, когда можно было открыть. */
  limp: number;
  threeBet: number;
  threeBetSizeBB: number;
  /** Колл чужого опена вне блайндов. */
  coldCall: number;
  /** Защита блайнда коллом и 3-бетом. */
  defendCall: number;
  defendThreeBet: number;
  foldTo3Bet: number;
  call3Bet: number;
  fourBet: number;
  cbet: number;
  wtsd: number;
  wsd: number;
  flop: StreetStats;
  turn: StreetStats;
  river: StreetStats;
  samples: ProfileSamples;
}

export const PROFILES: BotProfile[] = [
  {
    name: 'PokerMind',
    hands: 1292,
    archetype: 'tight-aggressive',
    vpip: 0.2539, pfr: 0.2167,
    openBy: { UTG: 0.229, HJ: 0.2109, CO: 0.3323, BTN: 0.3018, SB: 0.3193, BB: 0.2356 },
    openSizeBB: 3.0,
    limp: 0.0044,
    threeBet: 0.1205, threeBetSizeBB: 12.0,
    coldCall: 0.0445,
    defendCall: 0.1655, defendThreeBet: 0.0961,
    foldTo3Bet: 0.4279, call3Bet: 0.4156, fourBet: 0.1564,
    cbet: 0.5225, wtsd: 0.3579, wsd: 0.5571,
    flop: { betFirst: 0.3738, foldVsBet: 0.4118, callVsBet: 0.454, raiseVsBet: 0.1343, sizePct: 0.4756 },
    turn: { betFirst: 0.3608, foldVsBet: 0.4238, callVsBet: 0.4653, raiseVsBet: 0.111, sizePct: 0.6881 },
    river: { betFirst: 0.2963, foldVsBet: 0.5366, callVsBet: 0.3829, raiseVsBet: 0.0805, sizePct: 0.6944 },
    samples: { open: 847, threeBet: 379, vs3bet: 53, flops: 274, cbet: 116, flopVsBet: 101, turnVsBet: 69, riverVsBet: 50 },
  },
  {
    name: 'DuhaMetelkin',
    hands: 1954,
    archetype: 'tight-aggressive',
    vpip: 0.2364, pfr: 0.1571,
    openBy: { UTG: 0.1502, HJ: 0.1837, CO: 0.2142, BTN: 0.3781, SB: 0.2921, BB: 0.1394 },
    openSizeBB: 3.0,
    limp: 0.0321,
    threeBet: 0.0536, threeBetSizeBB: 12.125,
    coldCall: 0.1463,
    defendCall: 0.1945, defendThreeBet: 0.0437,
    foldTo3Bet: 0.4872, call3Bet: 0.3899, fourBet: 0.1229,
    cbet: 0.5614, wtsd: 0.3382, wsd: 0.5731,
    flop: { betFirst: 0.3045, foldVsBet: 0.5732, callVsBet: 0.3116, raiseVsBet: 0.1152, sizePct: 0.5005 },
    turn: { betFirst: 0.2637, foldVsBet: 0.5142, callVsBet: 0.3758, raiseVsBet: 0.11, sizePct: 0.6346 },
    river: { betFirst: 0.3654, foldVsBet: 0.5165, callVsBet: 0.3987, raiseVsBet: 0.0848, sizePct: 0.6487 },
    samples: { open: 1204, threeBet: 659, vs3bet: 54, flops: 384, cbet: 123, flopVsBet: 159, turnVsBet: 79, riverVsBet: 69 },
  },
  {
    name: 'griffie',
    hands: 801,
    archetype: 'tight-aggressive',
    vpip: 0.211, pfr: 0.1461,
    openBy: { UTG: 0.1477, HJ: 0.1469, CO: 0.1807, BTN: 0.3001, SB: 0.3532, BB: 0.2733 },
    openSizeBB: 3.0,
    limp: 0.0177,
    threeBet: 0.0587, threeBetSizeBB: 13.0,
    coldCall: 0.0681,
    defendCall: 0.2032, defendThreeBet: 0.0761,
    foldTo3Bet: 0.5206, call3Bet: 0.3754, fourBet: 0.1039,
    cbet: 0.5243, wtsd: 0.3417, wsd: 0.6197,
    flop: { betFirst: 0.2966, foldVsBet: 0.5192, callVsBet: 0.4075, raiseVsBet: 0.0732, sizePct: 0.5012 },
    turn: { betFirst: 0.3664, foldVsBet: 0.4954, callVsBet: 0.4435, raiseVsBet: 0.0611, sizePct: 0.5655 },
    river: { betFirst: 0.398, foldVsBet: 0.5644, callVsBet: 0.3468, raiseVsBet: 0.0889, sizePct: 0.6525 },
    samples: { open: 462, threeBet: 292, vs3bet: 23, flops: 125, cbet: 43, flopVsBet: 41, turnVsBet: 27, riverVsBet: 19 },
  },
  {
    name: 'RiverShark',
    hands: 889,
    archetype: 'tight-aggressive',
    vpip: 0.2655, pfr: 0.2137,
    openBy: { UTG: 0.2316, HJ: 0.1991, CO: 0.2582, BTN: 0.3507, SB: 0.2882, BB: 0.2075 },
    openSizeBB: 3.0,
    limp: 0.0251,
    threeBet: 0.141, threeBetSizeBB: 11.5,
    coldCall: 0.0273,
    defendCall: 0.1963, defendThreeBet: 0.1165,
    foldTo3Bet: 0.4056, call3Bet: 0.4881, fourBet: 0.1063,
    cbet: 0.4926, wtsd: 0.4278, wsd: 0.5453,
    flop: { betFirst: 0.3541, foldVsBet: 0.5573, callVsBet: 0.3609, raiseVsBet: 0.0818, sizePct: 0.4791 },
    turn: { betFirst: 0.3167, foldVsBet: 0.4546, callVsBet: 0.4252, raiseVsBet: 0.1202, sizePct: 0.6397 },
    river: { betFirst: 0.2516, foldVsBet: 0.5394, callVsBet: 0.4008, raiseVsBet: 0.0598, sizePct: 0.6885 },
    samples: { open: 592, threeBet: 247, vs3bet: 31, flops: 204, cbet: 93, flopVsBet: 57, turnVsBet: 44, riverVsBet: 31 },
  },
  {
    name: 'Solevarnya',
    hands: 2241,
    archetype: 'tight-aggressive',
    vpip: 0.2227, pfr: 0.1892,
    openBy: { UTG: 0.1873, HJ: 0.2184, CO: 0.2222, BTN: 0.4035, SB: 0.2336, BB: 0.1964 },
    openSizeBB: 2.75,
    limp: 0.012,
    threeBet: 0.094, threeBetSizeBB: 9.25,
    coldCall: 0.0552,
    defendCall: 0.1155, defendThreeBet: 0.0951,
    foldTo3Bet: 0.5345, call3Bet: 0.3514, fourBet: 0.1141,
    cbet: 0.5119, wtsd: 0.2951, wsd: 0.5576,
    flop: { betFirst: 0.3516, foldVsBet: 0.6512, callVsBet: 0.2663, raiseVsBet: 0.0824, sizePct: 0.5004 },
    turn: { betFirst: 0.3648, foldVsBet: 0.6032, callVsBet: 0.2822, raiseVsBet: 0.1146, sizePct: 0.6579 },
    river: { betFirst: 0.2001, foldVsBet: 0.6347, callVsBet: 0.2785, raiseVsBet: 0.0868, sizePct: 0.6994 },
    samples: { open: 1454, threeBet: 678, vs3bet: 70, flops: 395, cbet: 172, flopVsBet: 129, turnVsBet: 83, riverVsBet: 55 },
  },
  {
    name: 'YolandNorris',
    hands: 538,
    archetype: 'tight-aggressive',
    vpip: 0.2286, pfr: 0.1524,
    openBy: { UTG: 0.1766, HJ: 0.1527, CO: 0.2496, BTN: 0.2576, SB: 0.3476, BB: 0.2155 },
    openSizeBB: 3.0,
    limp: 0.0214,
    threeBet: 0.049, threeBetSizeBB: 9.0,
    coldCall: 0.1175,
    defendCall: 0.2102, defendThreeBet: 0.0573,
    foldTo3Bet: 0.4873, call3Bet: 0.3937, fourBet: 0.1191,
    cbet: 0.5911, wtsd: 0.2893, wsd: 0.6093,
    flop: { betFirst: 0.3477, foldVsBet: 0.5982, callVsBet: 0.3118, raiseVsBet: 0.09, sizePct: 0.5011 },
    turn: { betFirst: 0.292, foldVsBet: 0.4785, callVsBet: 0.4215, raiseVsBet: 0.0999, sizePct: 0.5705 },
    river: { betFirst: 0.3319, foldVsBet: 0.5981, callVsBet: 0.3418, raiseVsBet: 0.0601, sizePct: 0.5912 },
    samples: { open: 329, threeBet: 174, vs3bet: 15, flops: 103, cbet: 37, flopVsBet: 37, turnVsBet: 21, riverVsBet: 14 },
  },
  {
    name: 'KaplKapl',
    hands: 259,
    archetype: 'tight-aggressive',
    vpip: 0.2548, pfr: 0.2278,
    openBy: { UTG: 0.2139, HJ: 0.1938, CO: 0.3585, BTN: 0.3431, SB: 0.3295, BB: 0.2256 },
    openSizeBB: 2.5,
    limp: 0.0137,
    threeBet: 0.1133, threeBetSizeBB: 9.0,
    coldCall: 0.0801,
    defendCall: 0.1101, defendThreeBet: 0.0951,
    foldTo3Bet: 0.5673, call3Bet: 0.3194, fourBet: 0.1132,
    cbet: 0.5083, wtsd: 0.2886, wsd: 0.5486,
    flop: { betFirst: 0.3728, foldVsBet: 0.5791, callVsBet: 0.3335, raiseVsBet: 0.0874, sizePct: 0.4865 },
    turn: { betFirst: 0.3642, foldVsBet: 0.5259, callVsBet: 0.3851, raiseVsBet: 0.089, sizePct: 0.6136 },
    river: { betFirst: 0.3494, foldVsBet: 0.5934, callVsBet: 0.3361, raiseVsBet: 0.0705, sizePct: 0.6792 },
    samples: { open: 170, threeBet: 79, vs3bet: 9, flops: 41, cbet: 22, flopVsBet: 5, turnVsBet: 6, riverVsBet: 6 },
  },
  {
    name: 'statham1',
    hands: 250,
    archetype: 'tight-aggressive',
    vpip: 0.256, pfr: 0.188,
    openBy: { UTG: 0.1963, HJ: 0.1558, CO: 0.2191, BTN: 0.3298, SB: 0.3706, BB: 0.2155 },
    openSizeBB: 2.5,
    limp: 0.0146,
    threeBet: 0.0888, threeBetSizeBB: 9.0,
    coldCall: 0.0969,
    defendCall: 0.1875, defendThreeBet: 0.1165,
    foldTo3Bet: 0.5174, call3Bet: 0.362, fourBet: 0.1206,
    cbet: 0.5529, wtsd: 0.2515, wsd: 0.5715,
    flop: { betFirst: 0.3399, foldVsBet: 0.551, callVsBet: 0.3335, raiseVsBet: 0.1155, sizePct: 0.5784 },
    turn: { betFirst: 0.3232, foldVsBet: 0.5438, callVsBet: 0.3343, raiseVsBet: 0.1219, sizePct: 0.6545 },
    river: { betFirst: 0.2812, foldVsBet: 0.6066, callVsBet: 0.3213, raiseVsBet: 0.0721, sizePct: 0.6933 },
    samples: { open: 158, threeBet: 78, vs3bet: 6, flops: 45, cbet: 17, flopVsBet: 20, turnVsBet: 10, riverVsBet: 5 },
  },
  {
    name: 'Pavelvdn',
    hands: 768,
    archetype: 'tight-aggressive',
    vpip: 0.224, pfr: 0.1497,
    openBy: { UTG: 0.1021, HJ: 0.1435, CO: 0.1846, BTN: 0.2349, SB: 0.2231, BB: 0.1738 },
    openSizeBB: 2.5,
    limp: 0.0552,
    threeBet: 0.106, threeBetSizeBB: 10.0,
    coldCall: 0.1562,
    defendCall: 0.1182, defendThreeBet: 0.1165,
    foldTo3Bet: 0.4964, call3Bet: 0.4224, fourBet: 0.0812,
    cbet: 0.3695, wtsd: 0.3708, wsd: 0.4896,
    flop: { betFirst: 0.2425, foldVsBet: 0.4953, callVsBet: 0.4517, raiseVsBet: 0.053, sizePct: 0.5888 },
    turn: { betFirst: 0.286, foldVsBet: 0.4967, callVsBet: 0.427, raiseVsBet: 0.0763, sizePct: 0.5567 },
    river: { betFirst: 0.3322, foldVsBet: 0.504, callVsBet: 0.3711, raiseVsBet: 0.1249, sizePct: 0.6897 },
    samples: { open: 501, threeBet: 238, vs3bet: 16, flops: 166, cbet: 48, flopVsBet: 53, turnVsBet: 53, riverVsBet: 34 },
  },
  {
    name: 'Matthew0',
    hands: 577,
    archetype: 'tight-aggressive',
    vpip: 0.234, pfr: 0.1421,
    openBy: { UTG: 0.1103, HJ: 0.1455, CO: 0.1772, BTN: 0.3489, SB: 0.2294, BB: 0.2291 },
    openSizeBB: 3.0,
    limp: 0.0344,
    threeBet: 0.0773, threeBetSizeBB: 15.75,
    coldCall: 0.14,
    defendCall: 0.1983, defendThreeBet: 0.0743,
    foldTo3Bet: 0.5452, call3Bet: 0.3815, fourBet: 0.0734,
    cbet: 0.4704, wtsd: 0.2931, wsd: 0.5633,
    flop: { betFirst: 0.3111, foldVsBet: 0.5625, callVsBet: 0.3147, raiseVsBet: 0.1228, sizePct: 0.5012 },
    turn: { betFirst: 0.3413, foldVsBet: 0.5028, callVsBet: 0.3929, raiseVsBet: 0.1043, sizePct: 0.6297 },
    river: { betFirst: 0.3267, foldVsBet: 0.515, callVsBet: 0.4238, raiseVsBet: 0.0612, sizePct: 0.6013 },
    samples: { open: 335, threeBet: 212, vs3bet: 22, flops: 108, cbet: 27, flopVsBet: 49, turnVsBet: 28, riverVsBet: 13 },
  },
  {
    name: 'MASELL',
    hands: 234,
    archetype: 'loose-passive',
    vpip: 0.5726, pfr: 0.0342,
    openBy: { UTG: 0.0415, HJ: 0.0529, CO: 0.0754, BTN: 0.0959, SB: 0.0873, BB: 0.0677 },
    openSizeBB: 2.6,
    limp: 0.6255,
    threeBet: 0.0201, threeBetSizeBB: 9.0,
    coldCall: 0.5439,
    defendCall: 0.5718, defendThreeBet: 0.0342,
    foldTo3Bet: 0.0, call3Bet: 0.5556, fourBet: 0.4444,
    cbet: 0.3701, wtsd: 0.4453, wsd: 0.4765,
    flop: { betFirst: 0.1348, foldVsBet: 0.5237, callVsBet: 0.4345, raiseVsBet: 0.0418, sizePct: 0.9817 },
    turn: { betFirst: 0.1445, foldVsBet: 0.3033, callVsBet: 0.6456, raiseVsBet: 0.0511, sizePct: 0.5851 },
    river: { betFirst: 0.2816, foldVsBet: 0.5292, callVsBet: 0.3628, raiseVsBet: 0.108, sizePct: 1.0328 },
    samples: { open: 134, threeBet: 126, vs3bet: 0, flops: 126, cbet: 1, flopVsBet: 51, turnVsBet: 34, riverVsBet: 24 },
  },
  {
    name: 'Kokop2',
    hands: 327,
    archetype: 'loose-passive',
    vpip: 0.6514, pfr: 0.1162,
    openBy: { UTG: 0.1121, HJ: 0.1016, CO: 0.1449, BTN: 0.1999, SB: 0.215, BB: 0.1804 },
    openSizeBB: 2.0,
    limp: 0.54,
    threeBet: 0.043, threeBetSizeBB: 9.0,
    coldCall: 0.6241,
    defendCall: 0.5605, defendThreeBet: 0.0906,
    foldTo3Bet: 0.0, call3Bet: 0.5397, fourBet: 0.4603,
    cbet: 0.4106, wtsd: 0.4473, wsd: 0.5017,
    flop: { betFirst: 0.2638, foldVsBet: 0.4903, callVsBet: 0.4604, raiseVsBet: 0.0493, sizePct: 0.9282 },
    turn: { betFirst: 0.2176, foldVsBet: 0.3347, callVsBet: 0.5949, raiseVsBet: 0.0705, sizePct: 0.6348 },
    river: { betFirst: 0.3562, foldVsBet: 0.4511, callVsBet: 0.4721, raiseVsBet: 0.0768, sizePct: 0.6313 },
    samples: { open: 206, threeBet: 154, vs3bet: 16, flops: 199, cbet: 14, flopVsBet: 98, turnVsBet: 42, riverVsBet: 24 },
  },
  {
    name: '19771992',
    hands: 184,
    archetype: 'loose-passive',
    vpip: 0.6141, pfr: 0.1033,
    openBy: { UTG: 0.0668, HJ: 0.1203, CO: 0.0884, BTN: 0.1515, SB: 0.1305, BB: 0.1355 },
    openSizeBB: 2.6,
    limp: 0.5393,
    threeBet: 0.0638, threeBetSizeBB: 9.0,
    coldCall: 0.4936,
    defendCall: 0.6488, defendThreeBet: 0.0532,
    foldTo3Bet: 0.0, call3Bet: 0.5767, fourBet: 0.4233,
    cbet: 0.4038, wtsd: 0.3544, wsd: 0.5447,
    flop: { betFirst: 0.2344, foldVsBet: 0.5481, callVsBet: 0.3887, raiseVsBet: 0.0632, sizePct: 0.9496 },
    turn: { betFirst: 0.2982, foldVsBet: 0.3352, callVsBet: 0.6341, raiseVsBet: 0.0307, sizePct: 0.7927 },
    river: { betFirst: 0.3425, foldVsBet: 0.5447, callVsBet: 0.3437, raiseVsBet: 0.1116, sizePct: 0.8698 },
    samples: { open: 134, threeBet: 75, vs3bet: 2, flops: 98, cbet: 5, flopVsBet: 36, turnVsBet: 18, riverVsBet: 13 },
  },
  {
    name: 'JPSA',
    hands: 128,
    archetype: 'loose-passive',
    vpip: 0.5781, pfr: 0.0078,
    openBy: { UTG: 0.0443, HJ: 0.0511, CO: 0.0724, BTN: 0.0953, SB: 0.1024, BB: 0.0983 },
    openSizeBB: 2.6,
    limp: 0.5924,
    threeBet: 0.0117, threeBetSizeBB: 9.0,
    coldCall: 0.6072,
    defendCall: 0.6516, defendThreeBet: 0.0307,
    foldTo3Bet: 0.0, call3Bet: 0.5556, fourBet: 0.4444,
    cbet: 0.3701, wtsd: 0.4724, wsd: 0.6608,
    flop: { betFirst: 0.0809, foldVsBet: 0.4956, callVsBet: 0.4813, raiseVsBet: 0.0231, sizePct: 0.9263 },
    turn: { betFirst: 0.1208, foldVsBet: 0.3245, callVsBet: 0.6473, raiseVsBet: 0.0282, sizePct: 0.664 },
    river: { betFirst: 0.3471, foldVsBet: 0.4976, callVsBet: 0.3744, raiseVsBet: 0.128, sizePct: 0.7676 },
    samples: { open: 61, threeBet: 74, vs3bet: 0, flops: 72, cbet: 1, flopVsBet: 38, turnVsBet: 23, riverVsBet: 14 },
  },
  {
    name: 'Lucky9090',
    hands: 431,
    archetype: 'tight-passive',
    vpip: 0.3248, pfr: 0.0093,
    openBy: { UTG: 0.007, HJ: 0.011, CO: 0.0103, BTN: 0.0164, SB: 0.0171, BB: 0.0187 },
    openSizeBB: 2.6,
    limp: 0.366,
    threeBet: 0.0236, threeBetSizeBB: 9.0,
    coldCall: 0.3161,
    defendCall: 0.268, defendThreeBet: 0.008,
    foldTo3Bet: 0.2, call3Bet: 0.6, fourBet: 0.2,
    cbet: 0.3571, wtsd: 0.32, wsd: 0.5715,
    flop: { betFirst: 0.1151, foldVsBet: 0.6452, callVsBet: 0.3303, raiseVsBet: 0.0244, sizePct: 0.3967 },
    turn: { betFirst: 0.1897, foldVsBet: 0.6081, callVsBet: 0.3764, raiseVsBet: 0.0154, sizePct: 0.4744 },
    river: { betFirst: 0.2013, foldVsBet: 0.6034, callVsBet: 0.0961, raiseVsBet: 0.3005, sizePct: 0.9977 },
    samples: { open: 264, threeBet: 177, vs3bet: 0, flops: 127, cbet: 0, flopVsBet: 51, turnVsBet: 34, riverVsBet: 18 },
  },
  {
    name: 'Indadul',
    hands: 109,
    archetype: 'loose-passive',
    vpip: 0.4862, pfr: 0.1284,
    openBy: { UTG: 0.1324, HJ: 0.1564, CO: 0.1798, BTN: 0.3109, SB: 0.2508, BB: 0.1857 },
    openSizeBB: 2.6,
    limp: 0.3946,
    threeBet: 0.0263, threeBetSizeBB: 9.0,
    coldCall: 0.5847,
    defendCall: 0.5252, defendThreeBet: 0.0492,
    foldTo3Bet: 0.0, call3Bet: 0.5556, fourBet: 0.4444,
    cbet: 0.3369, wtsd: 0.3586, wsd: 0.4949,
    flop: { betFirst: 0.1722, foldVsBet: 0.5517, callVsBet: 0.4023, raiseVsBet: 0.046, sizePct: 0.8158 },
    turn: { betFirst: 0.2171, foldVsBet: 0.249, callVsBet: 0.7203, raiseVsBet: 0.0307, sizePct: 0.6315 },
    river: { betFirst: 0.2863, foldVsBet: 0.5942, callVsBet: 0.3371, raiseVsBet: 0.0686, sizePct: 0.7945 },
    samples: { open: 66, threeBet: 49, vs3bet: 0, flops: 49, cbet: 8, flopVsBet: 21, turnVsBet: 18, riverVsBet: 17 },
  },
  {
    name: 'Fish201302',
    hands: 142,
    archetype: 'loose-aggressive',
    vpip: 0.4718, pfr: 0.1831,
    openBy: { UTG: 0.1402, HJ: 0.1759, CO: 0.2424, BTN: 0.278, SB: 0.2778, BB: 0.172 },
    openSizeBB: 2.25,
    limp: 0.3077,
    threeBet: 0.1132, threeBetSizeBB: 9.0,
    coldCall: 0.1818,
    defendCall: 0.4194, defendThreeBet: 0.129,
    foldTo3Bet: 0.25, call3Bet: 0.5, fourBet: 0.25,
    cbet: 0.7778, wtsd: 0.381, wsd: 0.4583,
    flop: { betFirst: 0.549, foldVsBet: 0.45, callVsBet: 0.35, raiseVsBet: 0.2, sizePct: 0.667 },
    turn: { betFirst: 0.4839, foldVsBet: 0.2667, callVsBet: 0.7333, raiseVsBet: 0.0, sizePct: 0.467 },
    river: { betFirst: 0.5417, foldVsBet: 0.3, callVsBet: 0.7, raiseVsBet: 0.0, sizePct: 0.63 },
    samples: { open: 91, threeBet: 53, vs3bet: 4, flops: 63, cbet: 9, flopVsBet: 20, turnVsBet: 15, riverVsBet: 10 },
  },
  {
    name: 'Klybberth21',
    hands: 156,
    archetype: 'tight-passive',
    vpip: 0.3013, pfr: 0.1026,
    openBy: { UTG: 0.1211, HJ: 0.1275, CO: 0.1817, BTN: 0.1787, SB: 0.2182, BB: 0.1222 },
    openSizeBB: 2.0,
    limp: 0.1849,
    threeBet: 0.0235, threeBetSizeBB: 9.0,
    coldCall: 0.3353,
    defendCall: 0.3271, defendThreeBet: 0.0295,
    foldTo3Bet: 0.2093, call3Bet: 0.6047, fourBet: 0.186,
    cbet: 0.3601, wtsd: 0.3565, wsd: 0.5546,
    flop: { betFirst: 0.1353, foldVsBet: 0.6429, callVsBet: 0.3345, raiseVsBet: 0.0227, sizePct: 0.3456 },
    turn: { betFirst: 0.2505, foldVsBet: 0.6111, callVsBet: 0.3492, raiseVsBet: 0.0397, sizePct: 0.4091 },
    river: { betFirst: 0.1409, foldVsBet: 0.6087, callVsBet: 0.1211, raiseVsBet: 0.2702, sizePct: 1.1957 },
    samples: { open: 102, threeBet: 50, vs3bet: 3, flops: 51, cbet: 8, flopVsBet: 14, turnVsBet: 14, riverVsBet: 6 },
  },
  {
    name: 'Gumanaikl',
    hands: 225,
    archetype: 'tight-passive',
    vpip: 0.28, pfr: 0.0844,
    openBy: { UTG: 0.0619, HJ: 0.0853, CO: 0.1179, BTN: 0.1582, SB: 0.1367, BB: 0.1295 },
    openSizeBB: 2.6,
    limp: 0.2643,
    threeBet: 0.0456, threeBetSizeBB: 9.0,
    coldCall: 0.2435,
    defendCall: 0.2063, defendThreeBet: 0.056,
    foldTo3Bet: 0.2, call3Bet: 0.6, fourBet: 0.2,
    cbet: 0.3619, wtsd: 0.38, wsd: 0.6453,
    flop: { betFirst: 0.1382, foldVsBet: 0.6621, callVsBet: 0.2867, raiseVsBet: 0.0512, sizePct: 0.4653 },
    turn: { betFirst: 0.2625, foldVsBet: 0.549, callVsBet: 0.409, raiseVsBet: 0.042, sizePct: 0.5201 },
    river: { betFirst: 0.1778, foldVsBet: 0.5833, callVsBet: 0.1369, raiseVsBet: 0.2798, sizePct: 0.8967 },
    samples: { open: 135, threeBet: 94, vs3bet: 0, flops: 48, cbet: 5, flopVsBet: 23, turnVsBet: 11, riverVsBet: 8 },
  },
  {
    name: 'YnnzX',
    hands: 114,
    archetype: 'tight-passive',
    vpip: 0.2368, pfr: 0.0351,
    openBy: { UTG: 0.0707, HJ: 0.0697, CO: 0.0769, BTN: 0.1452, SB: 0.1294, BB: 0.091 },
    openSizeBB: 2.6,
    limp: 0.2005,
    threeBet: 0.0141, threeBetSizeBB: 9.0,
    coldCall: 0.3788,
    defendCall: 0.2703, defendThreeBet: 0.0159,
    foldTo3Bet: 0.1905, call3Bet: 0.5952, fourBet: 0.2143,
    cbet: 0.3484, wtsd: 0.292, wsd: 0.6111,
    flop: { betFirst: 0.1512, foldVsBet: 0.6143, callVsBet: 0.3612, raiseVsBet: 0.0245, sizePct: 0.3657 },
    turn: { betFirst: 0.2877, foldVsBet: 0.6275, callVsBet: 0.3501, raiseVsBet: 0.0224, sizePct: 0.4552 },
    river: { betFirst: 0.2062, foldVsBet: 0.6047, callVsBet: 0.1063, raiseVsBet: 0.289, sizePct: 0.9132 },
    samples: { open: 71, threeBet: 39, vs3bet: 2, flops: 30, cbet: 1, flopVsBet: 10, turnVsBet: 11, riverVsBet: 3 },
  },
];

export const PROFILE_BY_NAME: Record<string, BotProfile> = Object.fromEntries(
  PROFILES.map((p) => [p.name, p]),
);

/** Выборка, начиная с которой частоту можно считать измеренной, а не оценённой. */
export const RELIABLE_SAMPLE = 60;
