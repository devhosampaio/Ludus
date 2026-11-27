# Ludus — Design System

## Direção visual
**Editorial gamer + comunidade social.** Uma interface contemporânea, acolhedora e focada em conteúdo: capas de jogos, avaliações e pessoas. Evitar estética neon genérica, excesso de gradientes, glassmorphism decorativo e cards com informação comprimida.

## Princípios
1. Conteúdo primeiro: avaliações e capas têm prioridade visual.
2. Identidade gamer sem ruído: personalidade nos títulos, ícones e acentos; interface neutra para leitura.
3. Mobile-first: navegação inferior fixa, cabeçalho persistente, alvos de toque confortáveis.
4. Consistência: componentes reutilizáveis, tokens semânticos e estados previsíveis.
5. Acessibilidade: foco visível, contraste, movimento reduzido e texto que reflow sem cortes.

## Tokens
- Background: `#F5F4F8`
- Surface: `#FFFFFF`
- Text: `#211E2B`
- Muted: `#777284`
- Accent: `#6C56D9`
- Accent active: `#5540BD`
- Rating: `#E5A93D`
- Like: `#E34F69`
- Success: `#268B69`
- Border: `#E6E2ED`

### Tema escuro
- Background: `#15131C`
- Surface: `#201D29`
- Text: `#F3F0FA`
- Muted: `#AAA4B8`
- Accent: `#A494FF`
- Border: `#393446`

## Tipografia
- Display: Space Grotesk (títulos e marca)
- Interface: DM Sans (corpo, controles e metadados)
- Escala: 12 / 13 / 15 / 18 / 22 / 30 px

## Forma e espaçamento
- Escala de espaçamento: 4 / 8 / 12 / 16 / 24 / 32 / 40 px
- Raio: 8 / 12 / 18 / 24 px; pílulas somente para badges
- Cards: borda sutil + sombra discreta, sem contornos pesados
- Alvos interativos: mínimo recomendado de 44 × 44 px

## Componentes e padrões
- Review card: autor e tempo; capa + título/ano; nota e status; texto; ações sociais.
- Navegação mobile: header sticky + abas contextuais + bottom nav fixa com safe area.
- Perfil: capa, avatar sobreposto, username, estatísticas, bio, favoritos, listas e avaliações.
- Busca: campo amplo e resultados em grupos.
- Notificações: lista com estado não lido claramente indicado.
- Composer: modal/folha sobreposta, sem deslocar o feed.
- Admin: sidebar em desktop, menu compacto em mobile, métricas e listas em superfícies separadas.

## Responsividade
- Mobile: 320–767 px; uma coluna, bottom nav fixa, conteúdo sem overflow horizontal.
- Tablet: 768–1100 px; duas colunas quando necessário.
- Desktop: a partir de 1101 px; navegação lateral, coluna central de leitura e áreas auxiliares quando houver conteúdo.

## Escopo desta etapa
Redesign visual em CSS e tipografia. Mantidos JavaScript, autenticação, Supabase, tabelas, políticas RLS, rotas e integrações. Mudanças funcionais devem ser feitas em etapas separadas, com testes específicos.
