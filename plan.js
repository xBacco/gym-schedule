// The workout plan. Static data only — no logic.
// Each exercise: { name, setsReps, recText, restSeconds, superset }
export const PLAN = [
  {
    day: "A",
    title: "Petto + Tricipiti",
    exercises: [
      { name: "Panca piana bilanciere", setsReps: "3 × 6-8", recText: "2-3 min", restSeconds: 150, superset: false },
      { name: "Lento avanti manubri", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false },
      { name: "Croci ai cavi", setsReps: "3 × 12-15", recText: "75 sec", restSeconds: 75, superset: false },
      { name: "Dips", setsReps: "3 × 8-12", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Pulldown presa larga", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Pushdown tricipiti + Curl manubri", setsReps: "3 × 12-15 / 3 × 12-15", recText: "75 sec", restSeconds: 75, superset: true },
      { name: "Polpacci in piedi", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false },
      { name: "Crunch a terra + Plank", setsReps: "3 × 15-20 / 3 × max", recText: "45 sec", restSeconds: 45, superset: true },
    ],
  },
  {
    day: "B",
    title: "Dorso + Bicipiti + Gambe",
    exercises: [
      { name: "Stacco rumeno", setsReps: "3 × 8-10", recText: "2-3 min", restSeconds: 150, superset: false },
      { name: "Rematore bilanciere", setsReps: "4 × 8-10", recText: "2-3 min", restSeconds: 150, superset: false },
      { name: "Pullover con manubrio", setsReps: "3 × 12-15", recText: "75 sec", restSeconds: 75, superset: false },
      { name: "Affondi camminata o Goblet squat", setsReps: "3 × 10-12", recText: "90-120 s", restSeconds: 120, superset: false },
      { name: "Panca inclinata manubri", setsReps: "3 × 8-10", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 8-10 / 3 × 10-12", recText: "75 sec", restSeconds: 75, superset: true },
      { name: "Face pull", setsReps: "3 × 15-20", recText: "60 sec", restSeconds: 60, superset: false },
      { name: "Leg raise + Russian twist", setsReps: "3 × 12-15 / 3 × 20", recText: "45 sec", restSeconds: 45, superset: true },
    ],
  },
  {
    day: "C",
    title: "Spalle + Braccia",
    exercises: [
      { name: "Lento avanti bilanciere", setsReps: "4 × 6-8", recText: "2 min", restSeconds: 120, superset: false },
      { name: "Alzate laterali (manubri o cavo)", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false },
      { name: "Alzate posteriori (reverse fly)", setsReps: "3 × 15-20", recText: "60 sec", restSeconds: 60, superset: false },
      { name: "Spinte manubri panca piana (o chest press)", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Rematore al cavo, presa neutra", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 8-10 / 3 × 10-12", recText: "75 sec", restSeconds: 75, superset: true },
      { name: "Curl concentrato + Pushdown", setsReps: "2 × 15 / 2 × 15", recText: "60 sec", restSeconds: 60, superset: true },
      { name: "Crunch inverso + Plank laterale", setsReps: "3 × 15 / 3 × max/lato", recText: "45 sec", restSeconds: 45, superset: true },
    ],
  },
];
