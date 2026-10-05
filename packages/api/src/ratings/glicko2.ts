// Glicko-2 (Glickman, "Example of the Glicko-2 system", 2013) and FFA via pairwise decomposition
// (PRD §6.7): each finishing position is a win/loss against every other player, ties are draws.

export const SCALE = 173.7178;
export const DEFAULT_TAU = 0.5;
const EPS = 1e-6;

/** Glicko-2 scale: mu = (r - 1500) / SCALE, phi = RD / SCALE. */
export interface Glicko2Rating {
  mu: number;
  phi: number;
  sigma: number;
}

export const INITIAL: Glicko2Rating = { mu: 0, phi: 350 / SCALE, sigma: 0.06 };

export function fromGlicko1(rating: number, rd: number, sigma = 0.06): Glicko2Rating {
  return { mu: (rating - 1500) / SCALE, phi: rd / SCALE, sigma };
}

export function toGlicko1(r: Glicko2Rating) {
  return { rating: 1500 + SCALE * r.mu, rd: SCALE * r.phi, sigma: r.sigma };
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muj: number, phij: number) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

export interface Outcome {
  opponent: Glicko2Rating;
  /** 1 win, 0.5 draw, 0 loss */
  score: number;
}

/** One rating period for one player. */
export function rate(p: Glicko2Rating, outcomes: Outcome[], tau = DEFAULT_TAU): Glicko2Rating {
  if (outcomes.length === 0) {
    // Step 6 only: RD grows with inactivity.
    return { ...p, phi: Math.sqrt(p.phi * p.phi + p.sigma * p.sigma) };
  }
  let vInv = 0;
  let deltaSum = 0;
  for (const o of outcomes) {
    const gj = g(o.opponent.phi);
    const e = E(p.mu, o.opponent.mu, o.opponent.phi);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (o.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility via the Illinois algorithm.
  const a = Math.log(p.sigma * p.sigma);
  const phi2 = p.phi * p.phi;
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi2 - v - ex)) / (2 * (phi2 + v + ex) ** 2) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi2 + v) {
    B = Math.log(delta * delta - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi2 + sigma * sigma);
  const phi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const mu = p.mu + phi * phi * deltaSum;
  return { mu, phi, sigma };
}

/**
 * Free-for-all update. `scores[i]` is player i's final score (higher is better). All players are
 * rated against pre-game ratings, so the result does not depend on processing order.
 */
export function rateFfa(ratings: Glicko2Rating[], scores: number[], tau = DEFAULT_TAU): Glicko2Rating[] {
  if (ratings.length !== scores.length) throw new Error("ratings/scores length mismatch");
  return ratings.map((r, i) => {
    const outcomes: Outcome[] = [];
    for (let j = 0; j < ratings.length; j++) {
      if (j === i) continue;
      const s = scores[i]! > scores[j]! ? 1 : scores[i]! < scores[j]! ? 0 : 0.5;
      outcomes.push({ opponent: ratings[j]!, score: s });
    }
    return rate(r, outcomes, tau);
  });
}

/** 1-based placement with ties sharing the better place (e.g. scores 10,10,5 → 1,1,3). */
export function placements(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}
