// The workout plan. Static data only — no logic.
// Each exercise: { name, setsReps, recText, restSeconds, superset, muscle, muscleB?, unit?, unitB? }
// muscle = gruppo della traccia normale/A; muscleB = traccia B del superset.
// unit/unitB = "sec" per gli esercizi a tempo (plank): mostra "Secondi" e esce dal volume kg.
// Volume manubri: i nomi con "manubri/manubrio" contano entrambi i lati (×2), in automatico.
export const PLAN = [
  {
    day: "A",
    title: "Petto + Tricipiti",
    exercises: [
      { name: "Panca piana bilanciere", setsReps: "3 × 6-8", recText: "2 min", restSeconds: 120, superset: false, muscle: "Petto" },
      { name: "Lento avanti manubri", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false, muscle: "Spalle" },
      { name: "Croci ai cavi in piedi", setsReps: "3 × 12-15", recText: "75 sec", restSeconds: 75, superset: false, muscle: "Petto" },
      { name: "Dips", setsReps: "3 × 8-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Petto" },
      { name: "Pulldown presa larga", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Dorso" },
      { name: "Pushdown tricipiti + Curl manubri", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, muscle: "Tricipiti", muscleB: "Bicipiti" },
      { name: "Polpacci in piedi", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Polpacci" },
      { name: "Crunch a terra + Plank", setsReps: "3 × 15-20 / 3 × max", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core", unitB: "sec" },
    ],
  },
  {
    day: "B",
    title: "Dorso + Bicipiti + Gambe",
    exercises: [
      { name: "Stacco rumeno", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false, muscle: "Gambe" },
      { name: "Affondi con manubri", setsReps: "3 × 10-12", recText: "90-120 s", restSeconds: 120, superset: false, muscle: "Gambe" },
      { name: "Rematore bilanciere", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false, muscle: "Dorso" },
      { name: "Pullover con manubrio", setsReps: "3 × 12-15", recText: "75 sec", restSeconds: 75, superset: false, muscle: "Dorso" },
      { name: "Spinte su panca inclinata (manubri)", setsReps: "3 × 8-10", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Petto" },
      { name: "Curl manubri + French press", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, muscle: "Bicipiti", muscleB: "Tricipiti" },
      { name: "Face pull", setsReps: "3 × 12", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Spalle" },
      { name: "Leg raise + Russian twist", setsReps: "3 × 12-15 / 3 × 20", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core" },
    ],
  },
  {
    day: "C",
    title: "Spalle + Braccia",
    exercises: [
      { name: "Lento avanti bilanciere", setsReps: "3 × 6-8", recText: "2 min", restSeconds: 120, superset: false, muscle: "Spalle" },
      { name: "Alzate laterali", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Spalle" },
      { name: "Alzate posteriori (reverse fly)", setsReps: "3 × 12", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Spalle" },
      { name: "Spinte manubri panca piana", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Petto" },
      { name: "Rematore al cavo, presa neutra", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Dorso" },
      { name: "Rematore manubrio", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Dorso" },
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, bar: 10, muscle: "Bicipiti", muscleB: "Tricipiti" },
      { name: "Curl concentrato + Pushdown", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, muscle: "Bicipiti", muscleB: "Tricipiti" },
      { name: "Crunch inverso + Plank laterale", setsReps: "3 × 15 / 3 × max/lato", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core", unitB: "sec" },
    ],
  },
];

export function seedPlan({ empty = false } = {}) {
  return empty ? [] : PLAN;
}
