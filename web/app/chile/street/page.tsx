import { redirect } from 'next/navigation'

// El Visor Catastral se unificó con el módulo Catastro: mismo mapa satelital
// con polígonos de parcelas clicables, pero con la ficha completa del rol
// (dueño DealerNet, certificado TGR, construcciones) al hacer clic.
export default function StreetRedirect() {
  redirect('/chile/catastro')
}
