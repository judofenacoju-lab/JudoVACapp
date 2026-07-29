/** Fusionne des listes de clubs (insensible à la casse, ordre alphabétique fr). */
export function mergeRegisteredClubNames(...lists: Array<string[] | undefined | null>): string[] {
  const map = new Map<string, string>()
  for (const list of lists) {
    for (const raw of list ?? []) {
      const name = raw.trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (!map.has(key)) map.set(key, name)
    }
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'fr'))
}

let activeRegisteredClubs: string[] = []

export function setActiveRegisteredClubs(clubs: string[] | null | undefined): void {
  activeRegisteredClubs = mergeRegisteredClubNames(clubs ?? [])
}

export function getActiveRegisteredClubNames(): string[] {
  return [...activeRegisteredClubs]
}
