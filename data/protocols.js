// Standard test protocols. A test is a routine with `test` set to one of these ids: you
// choose its name, hold, grip and hands, while the timing comes from the protocol and
// can't be changed, so results compare over time. No DOM access (node --test).

export const PROTOCOLS = {
  maxPull: {
    name: "Max pull",
    description: "3 all-out pulls of 5 s with 90 s rest. Measures your strongest pull.",
    timing: { sets: 3, reps: 1, workS: 5, restS: 10, setRestS: 90, prepS: 5 },
    // Alternating: left and right pull in turn (10 s to change hand), then 90 s rest.
    hands: ["both", "left", "right", "alternate", "each"],
    handRestS: 90,
  },
  criticalForce: {
    name: "Critical force",
    description: "24 all-out pulls of 7 s with 3 s rest. Critical force is the average of the last 6 reps: the load you can sustain.",
    timing: { sets: 1, reps: 24, workS: 7, restS: 3, setRestS: 0, prepS: 5 },
    // No alternating: one hand would rest during the other's pulls and change the test.
    hands: ["both", "left", "right", "each"],
    handRestS: 600,
  },
  rfd: {
    name: "Rate of force development",
    description: "3 explosive pulls of 3 s with 30 s rest. Pull as fast and hard as you can from a relaxed hang.",
    timing: { sets: 3, reps: 1, workS: 3, restS: 10, setRestS: 30, prepS: 5 },
    hands: ["both", "left", "right", "alternate", "each"],
    handRestS: 30,
  },
};

export const TEST_IDS = Object.keys(PROTOCOLS);

// The routine with its protocol's fixed parts: timing, rest between hands, no target.
export function applyProtocol(r) {
  const p = PROTOCOLS[r.test];
  return {
    ...r,
    ...p.timing,
    type: "hangboard",
    setInstructions: [],
    addedWeightKg: null,
    target: { type: "none", value: 0 },
    handRestS: p.handRestS,
  };
}
