// GE Vernova 9HA.02 simple-cycle net output at ISO conditions, natural gas:
// https://www.gevernova.com/gas-power/products/gas-turbines/9ha
export const RATED_POWER_MW = 571;
export function energyKWh(powerMW:number, seconds:number) {
  return Math.max(0, powerMW) * 1000 * Math.max(0, seconds) / 3600;
}
export function householdDays(kWh:number, dailyKWh:number) {
  return dailyKWh > 0 && Number.isFinite(dailyKWh) ? Math.max(0, kWh) / dailyKWh : 0;
}
