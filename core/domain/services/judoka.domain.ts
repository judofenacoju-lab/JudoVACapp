import type { IJudokaRepository } from '@core/domain/repositories/judoka.repository'
export { computeAge, formatJudokaFullName } from '@shared/utils/judoka'

/** Domain service : wrappers éventuels autour des utilitaires partagés. */
export type { IJudokaRepository }
