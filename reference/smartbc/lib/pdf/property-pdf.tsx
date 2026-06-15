import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ReactElement } from "react";

// Documento PDF de una propiedad. Diseñado para enviarse al cliente con
// la marca BC, foto principal + datos clave + descripción + características
// + contacto. Tamaño A4 vertical, una página principal.

const COLORS = {
  ink: "#1f1c14",
  cream: "#f7f1e6",
  gold: "#d4af7f",
  goldDark: "#a8814a",
  inkSoft: "#5b5447",
  muted: "#8a8276",
  border: "#e6dccb",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 32,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: COLORS.ink,
    backgroundColor: COLORS.cream,
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: `1px solid ${COLORS.gold}`,
    paddingBottom: 10,
    marginBottom: 12,
  },
  brand: {
    fontFamily: "Times-Bold",
    fontSize: 14,
    letterSpacing: 1.6,
    color: COLORS.ink,
  },
  brandSub: {
    fontFamily: "Helvetica",
    fontSize: 8,
    letterSpacing: 2.5,
    color: COLORS.goldDark,
    marginTop: 2,
  },
  // Logo de la marca BC. Width fijo, height calculado por el ratio del
  // archivo (519:3282 alto:ancho según el PNG original).
  logo: {
    width: 130,
    height: Math.round(130 * (519 / 3282)),
    objectFit: "contain",
  },
  meta: {
    textAlign: "right",
    fontSize: 8,
    color: COLORS.muted,
  },
  // Title block
  operationBadge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: COLORS.goldDark,
    marginBottom: 4,
  },
  title: {
    fontFamily: "Times-Bold",
    fontSize: 18,
    lineHeight: 1.2,
    color: COLORS.ink,
    marginBottom: 4,
  },
  location: {
    fontSize: 9.5,
    color: COLORS.inkSoft,
    marginBottom: 0,
  },
  price: {
    fontFamily: "Times-Bold",
    fontSize: 20,
    color: COLORS.ink,
  },
  priceUnit: {
    fontSize: 10,
    color: COLORS.muted,
  },
  // Photo
  cover: {
    width: "100%",
    height: 200,
    objectFit: "cover",
    borderRadius: 6,
    marginTop: 10,
    marginBottom: 12,
  },
  // Specs row
  specsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 9,
    backgroundColor: "#ffffff",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    marginBottom: 12,
  },
  spec: { alignItems: "center" },
  specValue: { fontFamily: "Helvetica-Bold", fontSize: 13, color: COLORS.ink },
  specLabel: {
    fontSize: 7.5,
    color: COLORS.muted,
    letterSpacing: 1,
    marginTop: 2,
  },
  // Sections
  sectionTitle: {
    fontFamily: "Times-Bold",
    fontSize: 12,
    color: COLORS.ink,
    marginBottom: 5,
  },
  body: { fontSize: 9.5, lineHeight: 1.45, color: COLORS.inkSoft },
  featuresWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  feature: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    backgroundColor: "#ffffff",
    fontSize: 8.5,
    color: COLORS.ink,
  },
  // Footer
  footer: {
    marginTop: 14,
    padding: 12,
    backgroundColor: COLORS.ink,
    color: COLORS.cream,
    borderRadius: 6,
  },
  footerTitle: {
    fontFamily: "Times-Bold",
    fontSize: 11,
    color: COLORS.cream,
    marginBottom: 4,
  },
  footerLine: { fontSize: 8.5, color: COLORS.cream, marginBottom: 2 },
  // Generic
  section: { marginBottom: 10 },
  // Gallery page
  galleryPage: {
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 32,
    backgroundColor: COLORS.cream,
  },
  galleryHeader: {
    fontFamily: "Times-Bold",
    fontSize: 15,
    color: COLORS.ink,
    marginBottom: 3,
  },
  galleryHeaderSub: {
    fontSize: 9,
    color: COLORS.muted,
    marginBottom: 10,
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  galleryItem: {
    width: "49%",
    height: 215,
    objectFit: "cover",
    borderRadius: 4,
  },
  galleryFooter: {
    marginTop: 12,
    padding: 10,
    backgroundColor: COLORS.ink,
    color: COLORS.cream,
    borderRadius: 6,
    fontSize: 8.5,
  },
});

export type PropertyPdfData = {
  title: string;
  operation: "rent" | "sale";
  price: number;
  zone: string;
  city?: string;
  bedrooms: number;
  bathrooms: number;
  squareMeters: number | null;
  description: string | null;
  features: string[];
  // Foto principal: data URI ya en JPEG (ver route handler). Si es null,
  // se omite la imagen.
  coverPhotoUrl: string | null;
  // Galería adicional para la segunda página. Cada item es data URI JPEG.
  galleryPhotos: string[];
  // Logo BC en data URI (PNG). Si null, fallback al texto "BENJAMÍN COUSIÑO".
  logoDataUri: string | null;
  smartLink: string;
};

const BC = {
  brand: "BENJAMÍN COUSIÑO",
  sub: "PROPIEDADES · MADRID",
  email: "contacto@bcousinoprop.com",
  phone: "+34 694 20 97 63",
};

function fmtPrice(n: number): string {
  return new Intl.NumberFormat("es-ES").format(n);
}

export function PropertyPdfDocument({
  data,
}: {
  data: PropertyPdfData;
}): ReactElement {
  const isRent = data.operation === "rent";
  return (
    <Document
      title={`${data.title} — Benjamín Cousiño Propiedades`}
      author="Benjamín Cousiño Propiedades"
    >
      <Page size="A4" style={styles.page}>
        {/* Header con la marca y la fecha */}
        <View style={styles.header}>
          {data.logoDataUri ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={data.logoDataUri} style={styles.logo} />
          ) : (
            <View>
              <Text style={styles.brand}>{BC.brand}</Text>
              <Text style={styles.brandSub}>{BC.sub}</Text>
            </View>
          )}
          <View style={styles.meta}>
            <Text>{new Date().toLocaleDateString("es-ES")}</Text>
            <Text style={{ marginTop: 2 }}>{BC.email}</Text>
          </View>
        </View>

        {/* Operación + título + ubicación + precio */}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={styles.operationBadge}>
              {isRent ? "ALQUILER" : "VENTA"}
            </Text>
            <Text style={styles.title}>{data.title}</Text>
            <Text style={styles.location}>
              {data.zone}
              {data.city ? `, ${data.city}` : ""}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.price}>
              {fmtPrice(data.price)} €
              {isRent && <Text style={styles.priceUnit}> /mes</Text>}
            </Text>
          </View>
        </View>

        {/* Foto principal */}
        {data.coverPhotoUrl && (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={data.coverPhotoUrl} style={styles.cover} />
        )}

        {/* Specs */}
        <View style={styles.specsRow}>
          <View style={styles.spec}>
            <Text style={styles.specValue}>{data.bedrooms}</Text>
            <Text style={styles.specLabel}>DORMITORIOS</Text>
          </View>
          <View style={styles.spec}>
            <Text style={styles.specValue}>{data.bathrooms}</Text>
            <Text style={styles.specLabel}>BAÑOS</Text>
          </View>
          <View style={styles.spec}>
            <Text style={styles.specValue}>
              {data.squareMeters ? `${data.squareMeters} m²` : "—"}
            </Text>
            <Text style={styles.specLabel}>SUPERFICIE</Text>
          </View>
        </View>

        {/* Descripción */}
        {data.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Descripción</Text>
            <Text style={styles.body}>{data.description}</Text>
          </View>
        )}

        {/* Características */}
        {data.features.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Características</Text>
            <View style={styles.featuresWrap}>
              {data.features.map((f) => (
                <Text key={f} style={styles.feature}>
                  {f}
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* Footer / contacto */}
        <View style={styles.footer}>
          <Text style={styles.footerTitle}>¿Te interesa esta propiedad?</Text>
          <Text style={styles.footerLine}>Email: {BC.email}</Text>
          <Text style={styles.footerLine}>Teléfono: {BC.phone}</Text>
          <Text style={[styles.footerLine, { marginTop: 6, color: COLORS.gold }]}>
            Más fotos y detalles: {data.smartLink}
          </Text>
        </View>
      </Page>

      {/* Segunda página: galería de fotos. Solo si hay más de una foto. */}
      {data.galleryPhotos.length > 0 && (
        <Page size="A4" style={styles.galleryPage}>
          <Text style={styles.galleryHeader}>Galería · {data.title}</Text>
          <Text style={styles.galleryHeaderSub}>
            {data.zone}
            {data.city ? `, ${data.city}` : ""} ·{" "}
            {fmtPrice(data.price)} €
            {isRent && " /mes"}
          </Text>
          <View style={styles.galleryGrid}>
            {data.galleryPhotos.map((src, i) => (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image key={i} src={src} style={styles.galleryItem} />
            ))}
          </View>
          <View style={styles.galleryFooter}>
            <Text style={{ color: COLORS.cream, fontSize: 9 }}>
              Benjamín Cousiño Propiedades · {BC.email} · {BC.phone}
            </Text>
            <Text
              style={{
                color: COLORS.gold,
                fontSize: 8.5,
                marginTop: 3,
              }}
            >
              {data.smartLink}
            </Text>
          </View>
        </Page>
      )}
    </Document>
  );
}
