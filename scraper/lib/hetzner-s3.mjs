// ─────────────────────────────────────────────────────────────────────────────
// Adaptador delgado sobre @aws-sdk/client-s3 para Hetzner Object Storage
// (S3-compatible, plan Anuncios CL · H7/H20). Expone solo `putObject`, la
// única operación que necesita media-sync-cl.mjs — no una envoltura genérica
// de todo el SDK.
//
// NOTA IMPORTANTE (transparencia sobre el alcance de lo verificado): este
// adaptador se escribió siguiendo la API documentada de Hetzner Object
// Storage (S3-compatible, endpoint tipo https://hel1.your-objectstorage.com,
// URL pública virtual-hosted-style https://<bucket>.hel1.your-objectstorage.com/<key>)
// pero NO se probó contra el bucket real desde este entorno — no hay
// credenciales reales disponibles aquí ni sería prudente pedirlas por chat.
// La lógica de deduplicación que lo consume (media-sync-cl.mjs) SÍ está
// validada end-to-end con un cliente S3 simulado (inyección de dependencias,
// mismo patrón que resilient-fetch.mjs) — lo único pendiente de confirmar en
// producción es esta capa de I/O real, la primera vez que corra en el VPS.
// ─────────────────────────────────────────────────────────────────────────────
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

function publicUrlFor(endpoint, bucket, key) {
  const u = new URL(endpoint)
  return `${u.protocol}//${bucket}.${u.host}/${encodeURIComponent(key)}`
}

/**
 * Crea un cliente S3 apuntando al bucket de fotos de Hetzner Object Storage.
 * Lee credenciales de las variables HETZNER_S3_* (ver .env.example) por
 * defecto; se pueden pasar explícitas para el bucket de backups u otro uso.
 *
 * @param {object} [config]
 * @returns {{ putObject: (args: {key: string, body: Buffer, contentType?: string}) => Promise<string> }}
 */
export function createHetznerS3Client(config = {}) {
  const {
    endpoint = process.env.HETZNER_S3_ENDPOINT,
    region = process.env.HETZNER_S3_REGION || 'hel1',
    bucket = process.env.HETZNER_S3_BUCKET,
    accessKeyId = process.env.HETZNER_S3_ACCESS_KEY,
    secretAccessKey = process.env.HETZNER_S3_SECRET_KEY,
  } = config

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Faltan credenciales HETZNER_S3_* (endpoint/bucket/accessKeyId/secretAccessKey) — ver .env.example'
    )
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false, // Hetzner: virtual-hosted-style (<bucket>.<endpoint>)
  })

  return {
    /**
     * Sube un objeto y devuelve su URL pública. El bucket de fotos es
     * público-lectura (decisión del usuario, H7) — no se pasa ACL porque
     * Hetzner Object Storage fija la visibilidad a nivel de BUCKET, no de
     * objeto individual (a diferencia de S3 AWS clásico).
     */
    async putObject({ key, body, contentType }) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }))
      return publicUrlFor(endpoint, bucket, key)
    },
  }
}
