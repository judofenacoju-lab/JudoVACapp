/** Compte utilisateur Client créé par le Serveur. */
export interface UserAccount {
  id: string
  /** Identifiant de connexion (unique, sensible à la casse affichée). */
  username: string
  displayName?: string
  active: boolean
  createdAt: string
}
