import { z } from 'zod'

export const sexSchema = z.enum(['M', 'F'])

export const judokaFormSchema = z.object({
  lastName: z.string().trim().min(1, 'Nom requis').max(100),
  middleName: z.string().trim().max(100).default(''),
  firstName: z.string().trim().min(1, 'Prénom requis').max(100),
  sex: sexSchema,
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ'),
  province: z.string().trim().max(100).default(''),
  city: z.string().trim().max(100).default(''),
  commune: z.string().trim().max(100).default(''),
  address: z.string().trim().max(255).default(''),
  phone: z.string().trim().max(40).default(''),
  email: z.union([z.string().email('Email invalide'), z.literal('')]).default(''),
  club: z.string().trim().max(150).default(''),
  league: z.string().trim().max(150).default(''),
  sportProvince: z.string().trim().max(100).default(''),
  grade: z.string().trim().max(50).default(''),
  belt: z.string().trim().max(50).default(''),
  category: z.string().trim().max(50).default(''),
  weightKg: z.number().positive().max(300).nullable().default(null),
  heightCm: z.number().positive().max(250).nullable().default(null),
  licenseNumber: z.string().trim().max(80).default(''),
  affiliationYear: z
    .number()
    .int()
    .min(1950)
    .max(2100)
    .nullable()
    .default(null),
  photoPath: z.string().nullable().default(null),
  createdBy: z.string().trim().min(1),
  createdWorkstation: z.string().trim().min(1)
})

export type JudokaFormValues = z.infer<typeof judokaFormSchema>

export const clientConnectSchema = z.object({
  username: z.string().trim().min(1, 'Nom utilisateur requis').max(80),
  workstation: z.string().trim().min(1, 'Nom du poste requis').max(80),
  serverHost: z
    .string()
    .trim()
    .min(1, 'Adresse IP du serveur requise')
    .regex(
      /^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$|^[\w.-]+$/,
      'Adresse IP / hôte invalide'
    ),
  serverPort: z.number().int().min(1).max(65535).default(3847)
})

export type ClientConnectValues = z.infer<typeof clientConnectSchema>
