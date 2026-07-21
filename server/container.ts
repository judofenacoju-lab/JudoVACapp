import { app } from 'electron'
import { join } from 'path'
import { JsonJudokaRepository } from '@core/infrastructure/repositories/json-judoka.repository'
import type { IJudokaRepository } from '@core/domain/repositories/judoka.repository'
import { SystemLogger } from '@core/infrastructure/logging/system-logger'
import { UserAccountStore } from '@core/infrastructure/accounts/user-account-store'
import { CreateJudokaUseCase } from '@core/application/usecases/create-judoka.usecase'
import {
  GetJudokaStatsUseCase,
  ListJudokaUseCase,
  SearchJudokaUseCase
} from '@core/application/usecases/judoka-queries.usecase'
import {
  DeleteJudokaUseCase,
  GetJudokaUseCase,
  UpdateJudokaUseCase
} from '@core/application/usecases/update-delete-judoka.usecase'

function resolveUserDataPath(): string {
  try {
    return app.getPath('userData')
  } catch {
    return join(process.cwd(), '.judovac-data')
  }
}

/**
 * Composition root — stockage local JSON uniquement (pas de PostgreSQL).
 */
export class AppContainer {
  readonly logger: SystemLogger
  readonly userAccounts: UserAccountStore
  readonly userDataPath: string
  readonly jsonRepo: JsonJudokaRepository
  judokaRepo: IJudokaRepository
  createJudoka: CreateJudokaUseCase
  updateJudoka: UpdateJudokaUseCase
  deleteJudoka: DeleteJudokaUseCase
  getJudoka: GetJudokaUseCase
  listJudoka: ListJudokaUseCase
  searchJudoka: SearchJudokaUseCase
  getJudokaStats: GetJudokaStatsUseCase
  readonly dbReady = true
  readonly dbBackend = 'json' as const
  dbError: string | null = null

  constructor() {
    this.userDataPath = resolveUserDataPath()
    this.logger = new SystemLogger(this.userDataPath)
    this.userAccounts = new UserAccountStore(this.userDataPath)
    this.jsonRepo = new JsonJudokaRepository(this.userDataPath)
    this.judokaRepo = this.jsonRepo
    this.createJudoka = new CreateJudokaUseCase(this.jsonRepo, this.logger)
    this.updateJudoka = new UpdateJudokaUseCase(this.jsonRepo, this.logger)
    this.deleteJudoka = new DeleteJudokaUseCase(this.jsonRepo, this.logger)
    this.getJudoka = new GetJudokaUseCase(this.jsonRepo)
    this.listJudoka = new ListJudokaUseCase(this.jsonRepo)
    this.searchJudoka = new SearchJudokaUseCase(this.jsonRepo)
    this.getJudokaStats = new GetJudokaStatsUseCase(this.jsonRepo)
  }

  async initDatabase(): Promise<void> {
    this.dbError = null
    await this.logger.log('info', 'db.connect', 'Stockage local JSON initialisé')
  }

  async dispose(): Promise<void> {
    /* rien à fermer — fichiers locaux */
  }
}

let container: AppContainer | null = null

export function getContainer(): AppContainer {
  if (!container) container = new AppContainer()
  return container
}

export async function resetContainer(): Promise<void> {
  if (container) await container.dispose()
  container = null
}
