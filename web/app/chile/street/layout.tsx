// El visor de catastro ocupa toda la pantalla — sin sidebar ni padding del
// layout principal. Este layout sobreescribe el comportamiento del root layout
// solo para las rutas dentro de /chile/street.
export default function StreetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--c-bg)]"
      style={{ left: 0 }} // anula el marginLeft del sidebar del layout raíz
    >
      {children}
    </div>
  )
}
