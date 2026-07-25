import { judokaFormSchema } from '@shared/validation/judoka'
import type { DuplicateMatch, Judoka, JudokaCreateInput } from '@shared/types/judoka'
import type { IJudokaRepository } from '@core/domain/repositories/judoka.repository'
import { DuplicateError, ValidationError } from '@core/domain/errors'
import type { SystemLogger } from '@core/infrastructure/logging/system-logger'

export interface CreateJudokaOptions {
  /** Si true, ignore l'alerte doublon et force la création */
  force?: boolean
}

/**
 * Use case : création d'un judoka avec validation + détection doublons.
 */
export class CreateJudokaUseCase {
  constructor(
    private readonly repo: IJudokaRepository,
    private readonly logger: SystemLogger
  ) {}

  async execute(
    raw: unknown,
    options: CreateJudokaOptions = {}
  ): Promise<{ judoka: Judoka; duplicates?: DuplicateMatch[] }> {
    const parsed = judokaFormSchema.safeParse(raw)
    if (!parsed.success) {
      throw new ValidationError('Données judoka invalides', parsed.error.flatten())
    }

    const input = {
      ...(parsed.data as JudokaCreateInput),
      id: typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : undefined,
      displayId:
        typeof (raw as { displayId?: unknown })?.displayId === 'string'
          ? (raw as { displayId: string }).displayId
          : undefined
    }

    const duplicates = await this.repo.findDuplicates({
      lastName: input.lastName,
      firstName: input.firstName,
      middleName: input.middleName,
      birthDate: input.birthDate,
      club: input.club
    })

    if (duplicates.length > 0) {
      const ids = duplicates.map((d) => d.judoka.displayId).join(', ')
      throw new DuplicateError(
        `Doublon bloqué : un judoka avec le même Nom, Postnom, Prénom, Date de naissance et Club existe déjà (${ids}).`,
        { duplicates }
      )
    }

    const judoka = await this.repo.create(input)

    await this.logger.log('info', 'judoka.create', `Judoka créé ${judoka.displayId}`, {
      actor: judoka.createdBy,
      workstation: judoka.createdWorkstation,
      meta: { id: judoka.id }
    })

    return { judoka, duplicates: duplicates.length ? duplicates : undefined }
  }
}
