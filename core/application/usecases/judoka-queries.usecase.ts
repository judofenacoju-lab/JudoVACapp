import type { IJudokaRepository, JudokaSearchFilters } from '@core/domain/repositories/judoka.repository'
import type { Judoka } from '@shared/types/judoka'
import { hasRecordedWeight } from '@shared/utils/judoka'

export class SearchJudokaUseCase {
  constructor(private readonly repo: IJudokaRepository) {}

  execute(query: string, filters?: JudokaSearchFilters): Promise<Judoka[]> {
    return this.repo.search(query, filters)
  }
}

export class ListJudokaUseCase {
  constructor(private readonly repo: IJudokaRepository) {}

  execute(limit = 100, offset = 0): Promise<Judoka[]> {
    return this.repo.list(limit, offset)
  }
}

export class GetJudokaStatsUseCase {
  constructor(private readonly repo: IJudokaRepository) {}

  async execute(): Promise<{
    total: number
    male: number
    female: number
    weighed: number
    maleWeighed: number
    femaleWeighed: number
  }> {
    const items = await this.repo.list(50_000, 0)
    let male = 0
    let female = 0
    let weighed = 0
    let maleWeighed = 0
    let femaleWeighed = 0
    for (const j of items) {
      const hasWeight = hasRecordedWeight(j.weightKg)
      if (j.sex === 'F') {
        female += 1
        if (hasWeight) femaleWeighed += 1
      } else if (j.sex === 'M') {
        male += 1
        if (hasWeight) maleWeighed += 1
      }
      if (hasWeight) weighed += 1
    }
    return { total: items.length, male, female, weighed, maleWeighed, femaleWeighed }
  }
}
