/** Compte utilisateur créé par l'administrateur. */
export interface UserAccount {
  id: string
  /** Identifiant de connexion (unique). */
  username: string
  displayName?: string
  active: boolean
  createdAt: string
  role?: 'admin' | 'operator'
  /** Email de connexion (web). */
  email?: string
}

/** Réponse après création d'un compte — identifiants à communiquer à l'utilisateur. */
export interface CreatedUserAccount extends UserAccount {
  email: string
  password: string
}
