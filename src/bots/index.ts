/**
 * Публичный вход в модуль ботов.
 *
 * Профиль отвечает на вопрос «что этот игрок делал в реальности», ручки — на
 * вопрос «при каких порогах силы руки такое поведение получается». Вместе они
 * дают бота, который принимает решение по своим настоящим картам, а не по
 * броску кубика.
 */

export { PROFILES, PROFILE_BY_NAME, RELIABLE_SAMPLE } from './profiles';
export type { BotProfile, Archetype, StreetStats, ProfileSamples } from './profiles';
export { decide, defaultKnobs, preflopPercentile, isBluffCandidate } from './decide';
export type { BotKnobs, StreetKnobs, BotContext } from './decide';
export { analyse, handPercentile, findDraws, isStrongMade } from './strength';
export type { Strength, Draws } from './strength';
export { buildContext, simulate } from './sim';
export type { Counters, SimOptions } from './sim';

import { KNOBS } from './knobs';
import { defaultKnobs, type BotKnobs } from './decide';
import { PROFILES, type BotProfile } from './profiles';

/** Откалиброванные пороги для профиля; запасной вариант — расчёт из частот. */
export function knobsFor(profile: BotProfile): BotKnobs {
  return KNOBS[profile.name] ?? defaultKnobs(profile);
}

export const ALL_KNOBS: Map<string, BotKnobs> = new Map(
  PROFILES.map((p) => [p.name, knobsFor(p)]),
);
