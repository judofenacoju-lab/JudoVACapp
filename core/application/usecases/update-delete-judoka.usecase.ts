import { judokaFormSchema } from '@shared/validation/judoka'
import type { Judoka, JudokaCreateInput } from '@shared/types/judoka'
import type { IJudokaRepository } from '@core/domain/repositories/judoka.repository'
import { DuplicateError, NotFoundError, ValidationError } from '@core/domain/errors'
import type { SystemLogger } from '@core/infrastructure/logging/system-logger'

export class UpdateJudokaUseCase {
  constructor(
    private readonly repo: IJudokaRepository,
    private readonly logger: SystemLogger
  ) {}

  async execute(
    id: string,
    raw: unknown,
    options: { force?: boolean } = {}
  ): Promise<{ judoka: Judoka }> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Judoka', id)

    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const parsed = judokaFormSchema.safeParse({
      ...body,
      createdBy: (body.createdBy as string | undefined) ?? existing.createdBy,
      createdWorkstation:
        (body.createdWorkstation as string | undefined) ?? existing.createdWorkstation
    })
    if (!parsed.success) {
      throw new ValidationError('Données judoka invalides', parsed.error.flatten())
    }

    const input = parsed.data as JudokaCreateInput

    const duplicates = await this.repo.findDuplicates({
      lastName: input.lastName,
      firstName: input.firstName,
      middleName: input.middleName,
      birthDate: input.birthDate,
      licenseNumber: input.licenseNumber,
      excludeId: id
    })

    if (duplicates.length > 0 && !options.force) {
      throw new DuplicateError('Doublon potentiel détecté', { duplicates })
    }

    const judoka = await this.repo.update(id, input)

    await this.logger.log('info', 'judoka.update', `Judoka modifié ${judoka.displayId}`, {
      actor: input.createdBy,
      workstation: input.createdWorkstation,
      meta: { id }
    })

    return { judoka }
  }
}

export class DeleteJudokaUseCase {
  constructor(
    private readonly repo: IJudokaRepository,
    private readonly logger: SystemLogger
  ) {}

  async execute(id: string, actor?: string): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Judoka', id)
    await this.repo.delete(id)
    await this.logger.log('info', 'judoka.delete', `Judoka supprimé ${existing.displayId}`, {
      actor,
      meta: { id }
    })
  }
}

export class GetJudokaUseCase {
  constructor(private readonly repo: IJudokaRepository) {}

  async execute(id: string): Promise<Judoka> {
    const judoka = await this.repo.findById(id)
    if (!judoka) throw new NotFoundError('Judoka', id)
    return judoka
  }
}
