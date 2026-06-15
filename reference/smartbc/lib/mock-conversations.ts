import type { Conversation } from "@/lib/types";

export const mockConversations: Conversation[] = [
  {
    id: "c-001",
    participant: { name: "Javier Cousiño", initials: "JC" },
    lastPreview:
      "Te envío más información sobre el ático en Chamberí que visitamos.",
    lastTimestampLabelKey: "inicio.time.todayAt",
    lastTimestamp: "10:24",
    unreadCount: 2,
    messages: [
      {
        id: "m-1",
        fromMe: false,
        text: "Buenos días, María. Espero que estés bien.",
        time: "09:42",
        dateGroupKey: "messages.date.today",
      },
      {
        id: "m-2",
        fromMe: false,
        text: "Te envío más información sobre el ático en Chamberí que visitamos la semana pasada.",
        time: "09:43",
      },
      {
        id: "m-3",
        fromMe: true,
        text: "¡Genial, gracias Javier! ¿Tienes el plano detallado?",
        time: "10:05",
      },
      {
        id: "m-4",
        fromMe: false,
        text: "Sí, te lo adjunto en el email que te enviaré después de esta conversación.",
        time: "10:23",
      },
      {
        id: "m-5",
        fromMe: false,
        text: "También quería comentarte que el propietario está abierto a negociar el precio.",
        time: "10:24",
      },
    ],
  },
  {
    id: "c-002",
    participant: { name: "Laura de Benjamín Cousiño", initials: "LC" },
    lastPreview: "Nueva propiedad que podría interesarte en Recoletos.",
    lastTimestampLabelKey: "inicio.time.yesterdayAt",
    lastTimestamp: "18:45",
    unreadCount: 1,
    messages: [
      {
        id: "m-1",
        fromMe: false,
        text: "Hola María, soy Laura del equipo de Benjamín Cousiño Propiedades.",
        time: "18:42",
        dateGroupKey: "messages.date.yesterday",
      },
      {
        id: "m-2",
        fromMe: false,
        text: "Hemos recibido una nueva propiedad que encaja con tus criterios: un piso de 3 dormitorios en Recoletos.",
        time: "18:44",
      },
      {
        id: "m-3",
        fromMe: false,
        text: "Si te interesa, podemos organizar una visita esta semana.",
        time: "18:45",
      },
    ],
  },
  {
    id: "c-003",
    participant: { name: "Ana Sánchez", initials: "AS" },
    lastPreview: "Documentación firmada correctamente. ¡Gracias!",
    lastTimestampLabelKey: "inicio.time.yesterdayAt",
    lastTimestamp: "12:11",
    unreadCount: 0,
    messages: [
      {
        id: "m-1",
        fromMe: true,
        text: "Hola Ana, te envío la documentación firmada para el contrato del piso en Velázquez.",
        time: "11:55",
        dateGroupKey: "messages.date.yesterday",
      },
      {
        id: "m-2",
        fromMe: false,
        text: "Documentación firmada correctamente. ¡Gracias!",
        time: "12:11",
      },
      {
        id: "m-3",
        fromMe: false,
        text: "Procedemos a tramitarla con el propietario y te aviso en cuanto tengamos el visto bueno.",
        time: "12:12",
      },
    ],
  },
];
