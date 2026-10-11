/**
 * The pure settlement rules the backend uses, re-exported for pages that show live numbers
 * (detention accrued right now, silent-line eligibility). Same code, same answers.
 */
export { accrued, accruedAt, detentionDaysAt, silentLineEligible } from '../shared/domain/rules';
export { fromUnits, toUnits } from '../shared/domain/money';
