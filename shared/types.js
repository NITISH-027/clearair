/**
 * Shared JSDoc type definitions for the profile, air data, plan and exposure
 * model. This module holds types only and has no runtime code.
 */

/** @typedef {{children: boolean, elderly: boolean, respiratory: boolean, pregnant: boolean}} Household */
/** @typedef {{mode: string, hours: number}} Commute */
/** @typedef {{windows: string, purifier: boolean, purifierCadr: number, cooking: string}} Home */
/** @typedef {{household: Household, commute: Commute, exercise: {outdoorHours: number}, home: Home}} Profile */

/** @typedef {{time: string, pm25: number, aqi: number}} HourlyPoint */
/** @typedef {{startTime: string, label: string, pm25: number}} BestWindow */
/** @typedef {{name: string, region: string, country: string, lat: number, lon: number}} Place */
/** @typedef {{aqi: number, pm25: number, pm10: number|null, time: string|null}} CurrentAir */
/** @typedef {{place: Place|null, current: CurrentAir, hourly: HourlyPoint[], source: string, dataSource: string}} AirData */

/** @typedef {{mask?: boolean, windowsClosed?: boolean, purifier?: boolean, exerciseIndoors?: boolean, shiftExercise?: boolean, cleanCooking?: boolean, cookingVent?: boolean}} ExposureFlags */
/** @typedef {{pm25: number, bestPm25?: number|null, profile: Profile}} ExposureContext */
/** @typedef {{dose: number, volume: number, meanConcentration: number, indoorConcentration: number}} ExposureDetail */

/** @typedef {{id: string, section: string, title: string, action: string, why: string, note?: string, impactPercent?: number}} PlanItem */
/** @typedef {{id: string, title: string, items: PlanItem[]}} PlanSection */
/** @typedef {{baseline: number, withPlan: number, reductionPercent: number, meanConcentration: number, meanConcentrationWithPlan: number, whoGuideline: number, pm25Used: number, unit: string}} ExposureBlock */
/** @typedef {{aqi: number, category: string, level: number, summary: string, bestWindow: BestWindow|null, sections: PlanSection[], actionIds: string[], exposure: ExposureBlock}} Plan */
/** @typedef {{profile: Profile, level: number, bestWindow: BestWindow|null, pm25: number, bestPm25: number|null}} PlanContext */

/** @typedef {{plan: Plan, air: AirData, ai: any}} PlanResponse the /api/plan response body */

export {};
