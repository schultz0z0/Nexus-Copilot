# Prometeus — Design system

Versão **1.0.0** · 26 de setembro de 2026 · idioma **pt-BR**

Este é o contrato visual portátil da Prometeus. Serve para Codex, Claude, Antigravity e outros agentes, sem depender de uma skill ou ferramenta específica. Antes de editar uma interface, leia também o `AGENTS.md` da raiz e o [contrato de interação do produto](../../apps/chat-web/DESIGN.md).

## 1. Fontes, escopo e precedência

1. A identidade foi aprovada pelo responsável após sua aplicação no sistema.
2. Referência visual: [site da Prometeus](https://agenciaprometeus.com.br/), inspecionado em 26/09/2026, e manual original desta pasta. A primeira página do PDF original pertence à agência criadora e **não é referência da Prometeus**.
3. Nome público: **Prometeus**. Não usar “Prometeus Marketing”, “Marketing ENS” ou “Nexus AI” como nome do produto.
4. O robô original e os dois balões foram mantidos por decisão explícita do responsável.
5. O código em `apps/chat-web/src/index.css` é a fonte dos tokens em execução. `tailwind.config.ts` faz a adaptação para as classes semânticas.
6. O [JSON](design-system.json) é um retrato versionado desses valores, acrescido de regras de composição. Não é importado automaticamente pela aplicação e não declara compatibilidade com DTCG. As chaves `provenance` distinguem implementação observada de recomendações para conteúdo novo.
7. O [manual visual](manual-da-marca.html) demonstra aplicações e estados. Seus controles são exemplos locais, sem conexão com o produto. As capturas usam dados de demonstração.

Não sobrescrever valores em execução só porque um exemplo editorial deste manual usa uma composição diferente. Ao mudar um token, atualizar CSS, JSON, este documento e os exemplos afetados na mesma alteração. Requisitos de negócio, acessibilidade, segurança e instruções do responsável continuam válidos.

## 2. Essência e voz

**Tecnologia que amplia pessoas.** A marca combina precisão técnica com proximidade humana. Sua presença é escura, sóbria e clara; o azul dá direção às ações. Espaço, hierarquia e contraste fazem o trabalho principal. Brilho e movimento são apoio.

| Atributo | Aplicação | Evitar |
| --- | --- | --- |
| Precisa | Rótulos concretos, dados identificáveis, resultado explícito | Superlativos vazios e promessas de resultado garantido |
| Humana | Português natural, orientações úteis, robô na recepção | Culpar o usuário; mensagens mecânicas sem próximo passo |
| Confiante | Uma ação principal clara por região de decisão | Muitos botões azuis competindo na mesma região |
| Tecnológica | Tipografia limpa, detalhes técnicos em mono, superfícies escuras | Néon decorativo, efeitos que prejudicam a leitura |

Use frase normal nos rótulos: “Criar campanha”, “Salvar alterações”, “Tentar novamente”. Erros explicam o problema e como resolvê-lo: “Selecione um responsável para continuar.” Estados de espera descrevem a ação: “Salvando…”. Use emojis com parcimônia; os dois do mascote fazem parte da composição aprovada. Não inventar resultados ou estados de sucesso para deixar a tela bonita.

## 3. Marca gráfica e mascote

| Elemento | Arquivo do produto | Uso |
| --- | --- | --- |
| Logo principal | `apps/chat-web/public/brand/prometeus-logo.png` | Fundo midnight ou superfícies escuras; versão azul e branca |
| Logo branca | `apps/chat-web/public/brand/prometeus-logo-white.png` | Fundo azul institucional e composições que pedem marca monocromática |
| Símbolo | `apps/chat-web/public/brand/prometeus-symbol.png` | Favicon, rail e espaços compactos |
| Mascote | `apps/chat-web/public/mascot.svg` | Boas-vindas e contexto do assistente |

As cópias para consulta offline estão em `assets/`, com hashes no JSON. Os originais fornecidos pelo responsável permanecem nesta pasta. A logo principal mede 322 × 88 px; a branca, 532 × 145 px; o símbolo, 500 × 500 px com margem transparente interna. Manter essa margem e usar `object-contain`. Não recortar automaticamente o símbolo para “corrigir” o alinhamento.

- Preferir o componente `BrandLogo`; largura padrão da assinatura: 160 px; caixa padrão do símbolo: 64 × 64 px.
- Manter proporção, transparência e cores do arquivo. Não reconstruir a logo digitando “prometeus”, mesmo usando Outfit. Não aplicar blur, contorno, perspectiva, recoloração ou sombra na marca.
- Reservar, como **regra operacional para novas peças**, espaço livre externo de pelo menos metade da altura visível da assinatura em todos os lados. Essa medida é uma recomendação deste sistema digital, não uma transcrição de medida numérica do PDF original.
- Para novas peças, preferir assinatura com largura de pelo menos 160 px. Em espaços menores, avaliar o símbolo existente e testar sua legibilidade no tamanho final. Não extrapolar o PNG pequeno para impressão grande: solicitar matriz vetorial original.
- Em fundo claro, colocar a assinatura em uma área institucional midnight ou azul, sem inventar uma versão escura da palavra.
- `alt="Prometeus"` quando a marca identifica o produto; `alt=""` quando redundante com texto acessível adjacente. Um link de logo precisa ter destino e nome acessível claros.

O mascote **não substitui a logo**. Preservar o robô original, incluindo seus olhos ciano. Na recepção, usar 120 × 140 px e os balões “Vamos crescer? 👋” e “Potencialize já! ✨”. Os balões aparecem a partir de 1024 px e usam superfície escura; são decorativos, não botões. Respeitar `prefers-reduced-motion`. Não gerar outro personagem para substituí-lo.

## 4. Cores oficiais

| Nome | HEX | Token primitivo | Função |
| --- | --- | --- | --- |
| Midnight | `#040814` | `--prometeus-midnight` | Canvas, profundidade, base da identidade |
| Azul Prometeus | `#0652C5` | `--prometeus-blue` | Ação principal, destaque institucional |
| Branco | `#FFFFFF` | `--prometeus-white` | Texto principal e texto sobre azul |
| Azul escuro | `#1A2338` | `--prometeus-navy` | Apoio, seleção e superfície secundária |
| Azul cinza | `#3B4B6B` | `--prometeus-slate` | Contornos e estrutura |
| Cinza claro | `#E2E8F0` | `--prometeus-mist` | Texto secundário e contraste |

O azul de ação não é adequado como texto pequeno sobre midnight. Links e foco usam `--brand-accent`, um azul claro derivado. Cores de status são semânticas, não novas cores institucionais. A identidade digital atual é escura e não muda automaticamente com o tema do sistema operacional.

## 5. Tokens: três níveis, uma fonte em execução

**Primitivos → semânticos → receitas de componente.** Exemplo: `--prometeus-blue` → `--primary` → `Button` com `bg-primary`. Componentes devem consumir os nomes semânticos; não espalhar valores HEX ou novas escalas arbitrárias pelas telas.

| Necessidade | Token / classe |
| --- | --- |
| Canvas | `--background` / `bg-background` |
| Texto principal | `--foreground` / `text-foreground` |
| Painel | `--card` + `--card-foreground` / `bg-card text-card-foreground` |
| Menu / popover | `--popover` + `--popover-foreground` |
| Texto secundário | `--text-secondary` / `text-text-secondary` |
| Texto discreto | `--muted-foreground` / `text-muted-foreground` |
| Botão principal | `--primary` + `--primary-foreground` |
| Ação secundária | `--secondary` + `--secondary-foreground` |
| Link e foco | `--brand-accent`, `--ring` |
| Borda estrutural | `--border` / `border-border` |
| Borda de campo | `--input` / `border-input` |
| Erro em painel escuro | `--status-error` / `text-status-error` |
| Aviso em painel escuro | `--status-warning` / `text-status-warning` |
| Sucesso em painel escuro | `--status-success` / `text-status-success` |

O JSON registra todos os 59 tokens CSS, incluindo aliases, HSL resolvido, HEX de consulta, tipografia e sombras. Os valores HSL devem ser usados como `hsl(var(--token))`, porque a variável contém apenas os canais, sem a função `hsl()`.

**Atenção a nomes semelhantes:** `--success` e `--warning` não são as cores recomendadas para texto corrido em painel escuro. Use `--status-success` e `--status-warning`. Badges legados com fundo claro e texto escuro conservam o par; não reutilize só o texto escuro sobre o canvas.

## 6. Tipografia

| Papel | Família | Pesos |
| --- | --- | --- |
| Interface, títulos, texto editorial | Space Grotesk | 400, 500, 600, 700 |
| Código, hashes, identificadores | Geist Mono | 400, 500 |
| Desenho do logotipo | Outfit | Preservado na arte original; não compor nova logo |

A aplicação carrega as fontes via Google Fonts em `index.html`; há fallbacks de sistema no CSS. O manual também funciona com fallback se a rede não estiver disponível. O carregamento não deve bloquear conteúdo. Para um novo ambiente offline, fornecer arquivos de fontes com suas licenças antes de exigir reprodução tipográfica exata.

Escala recomendada para conteúdo novo, baseada no repertório Tailwind existente:

| Papel | Tamanho / entrelinha | Peso habitual |
| --- | --- | --- |
| Legenda e metadados | 12 / 16 px | 400–500 |
| Rótulo e texto compacto | 14 / 20 px | 400–500 |
| Corpo | 16 / 24 px | 400 |
| Subtítulo | 18 / 28 px | 500–600 |
| Título de seção | 24 / 32 px | 600 |
| Título de página | 32 / 40 px | 500–600 |
| Abertura editorial | `clamp(2rem, 5vw, 4.5rem)` / 1.05 | 500 |

Em componentes existentes, preservar o tamanho implementado. Não usar 12 px para parágrafos. Limitar textos longos a aproximadamente 60–75 caracteres por linha quando a composição permitir. Usar números tabulares em colunas comparáveis. Títulos mantêm caixa de frase; caixa alta e tracking amplo só em rótulos editoriais curtos.

O degradê prata (`brand-heading`) cabe na recepção e na abertura editorial. Corpo, instruções, dados e erros usam cor sólida. Não aplicar texto transparente sem fallback em modo de contraste forçado.

## 7. Espaço, forma e profundidade

- Base: 4 px. Escala preferida para novas composições: 4, 8, 12, 16, 24, 32, 48, 64 e 96 px.
- Ícone + rótulo: 8 px. Campos empilhados: 16 px. Padding de card: 24 px. Separação de seções de interface: 32 px.
- Recomendação de margens novas: 16 px no mobile, 32 px no desktop. Não substituir o espaçamento de telas existentes sem necessidade funcional.
- Raios implementados: `rounded-sm` 8 px, `rounded-md` 10 px, `rounded-lg` 12 px. `rounded-xl` também equivale a 12 px; `rounded-2xl`, 16 px. Composer: 24 px. Cápsulas somente em badges, avatares e controles que já adotam esse formato.
- Bordas: geralmente 1 px. As bordas estruturais podem ser sutis; o contorno que identifica um controle precisa ser avaliado com seu contexto e contraste.
- `glass-surface`: degradê opaco a 145° entre superfície sutil e superfície, com borda. Apesar do nome histórico, não é vidro branco translúcido.
- `glass-sidebar`: superfície a 97% com blur de 20 px. Menus e diálogos precisam de fundo opaco e texto legível.
- Sombras canônicas: `--shadow-sm`, `--shadow-md`, `--shadow-lg`. As classes Tailwind `shadow-sm/md/lg` existentes não são automaticamente aliases dessas variáveis; `shadow-glass` usa `--shadow-md`. Não assumir uma ligação que não existe no adapter.
- Luz azul radial do canvas: opacidade de 9%. Composer: halo de 8%; foco em anel de 3 px com azul a 18%. Não aumentar a intensidade em toda a tela.

## 8. Componentes e estados

Reutilizar `apps/chat-web/src/components/ui/` e componentes de domínio. As receitas novas abaixo são composições recomendadas, não APIs já implementadas. Em especial, `Button` não possui uma propriedade `loading`: compor `disabled`, `aria-busy`, ícone e texto.

### Botões e links

| Variante existente | Uso | Estado visual |
| --- | --- | --- |
| `default` | Decisão principal | Azul + branco; hover azul /90; active /80 |
| `secondary` | Ação de apoio | Navy + mist; hover /80 |
| `outline` | Alternativa | Canvas + borda input; hover accent |
| `ghost` | Ação discreta | Transparente; hover accent |
| `link` | Navegação textual | Azul claro; sublinhado no hover |
| `destructive` | Ação destrutiva | Destructive + branco; confirmação quando necessária |

Alturas existentes: pequeno 36 px, padrão 40 px, grande 44 px, ícone 40 × 40 px. Fonte 14 px, raio 10 px, ícone 16 px. Foco: anel de 2 px em `ring`, afastamento de 2 px. Desabilitado: opacidade 50% e sem interação. Para novas telas sensíveis a toque, ampliar área acionável a 44 × 44 px; não afirmar que os controles compactos atuais já atendem a essa medida.

Carregando: manter largura, usar “Salvando…” ou equivalente, `aria-busy="true"`, impedir envio duplicado. Ícone sem texto exige nome acessível. Link navega; botão executa. Nunca deixar uma ação acessível apenas por hover.

### Campos, seleção e validação

`Input`: altura 40 px, padding horizontal 12 px, raio 10 px, fundo background, borda input; texto 16 px no mobile e 14 px a partir de md. Label persistente associado por `htmlFor`/`id`; placeholder só exemplifica. Ajuda e erro ligados por `aria-describedby`; inválido com `aria-invalid`.

Exibir erro com texto `text-status-error` e explicação objetiva. Preservar valor digitado. Validar no momento apropriado ao fluxo, sem anunciar erros a cada tecla indiscriminadamente. `Select`, `Checkbox`, `RadioGroup` e `Switch` usam os wrappers Radix existentes; manter teclado, foco e estados nativos. O erro de um grupo deve estar associado ao grupo, não só a uma borda vermelha.

### Cards e listas

`Card`: background card, texto card-foreground, borda border, raio 12 px e padding 24 px. Título, descrição, conteúdo e ações têm hierarquia explícita. Nem todo conteúdo precisa de um card; prefira linhas e divisórias quando forem suficientes. Não aninhar painéis em excesso.

Card clicável precisa de controle semântico e estado de foco; evitar `div` com clique ou botões aninhados. Listas podem quebrar títulos e descrições; IDs longos usam mono com quebra ou truncamento recuperável.

### Status, alertas e resultados

| Estado | Texto no escuro | Informação necessária |
| --- | --- | --- |
| Informação | `text-brand-accent` | Contexto e próximo passo |
| Sucesso | `text-status-success` | O que foi concluído |
| Aviso / pendência | `text-status-warning` | O que falta e quem pode agir |
| Erro | `text-status-error` | Problema e recuperação |

Sempre combinar cor com texto e, quando útil, ícone. Toast complementa o resultado persistente; não é a única prova de uma mutação. Skeleton representa a geometria do conteúdo, com uma mensagem acessível de carregamento. Estado vazio explica o contexto e oferece a próxima ação pertinente; erro não pode parecer lista vazia.

### Diálogos, menus e tooltips

Usar Radix por meio dos wrappers existentes. `DialogContent` padrão: largura máxima 512 px, padding 24 px, fundo background; overlay background a 80%, z-index 50. O CSS do componente é a referência para detalhes de animação e arredondamento.

Em composições novas, garantir margens no mobile, altura limitada à área visível e rolagem do corpo. Título e descrição acessíveis, foco contido, Escape e devolução do foco ao gatilho. Ações empilhadas em telas estreitas. Não abrir vários diálogos concorrentes. Tooltip também aparece ao foco e não guarda informação essencial sozinho.

### Navegação e tabelas

Tabs existentes têm lista de 40 px em muted e item ativo em background + foreground. Não transformar todas as tabs em azul por decoração. Usar setas de teclado e associação tab/painel. Menus e selects usam superfície popover opaca.

Tabelas mantêm semântica, cabeçalhos e alinhamento consistente. Números à direita quando comparáveis, texto à esquerda. Em telas estreitas, reduzir colunas secundárias com acesso aos detalhes ou confinar a rolagem horizontal à tabela nomeada; nunca à página inteira. Oferecer estados de carregamento, erro, vazio, seleção e paginação quando o fluxo exigir.

### Chat e planos de ação

Manter o robô, balões e boas-vindas aprovados. Composer com raio 24 px, superfície escura e foco claro. Botão de envio e bolha do usuário usam o degradê azul a 160° já implementado. Mensagens respeitam largura disponível; blocos de código têm rolagem própria.

Planos executáveis são dados estruturados do servidor. Exibir identidade, ações imutáveis, prazo e controle **Executar plano**. Uma frase do modelo não é autorização. Recibos terminais continuam visíveis após recarregar e não oferecem novamente a execução. “Solicitação de aprovação criada — pendente” não significa “aprovado”. Preservar o contrato completo de `apps/chat-web/DESIGN.md`.

### Dashboards e informação sob demanda

Na visão geral, mostrar somente os indicadores essenciais, um aviso curto de
saúde e até dois gráficos de leitura imediata. Preferir uma faixa de indicadores
com divisórias leves a quatro cards independentes. Dar espaço aos números e
evitar repetir o mesmo diagnóstico em cards, parágrafos e tabelas.

Funil detalhado, custos, critérios e fontes podem abrir em diálogos Radix. A
análise de uma campanha pertence à página dessa campanha, com filtros de período
e canal limitados ao seu escopo. Usar links para páginas e botões para detalhes.
Organizar planejamento, equipe, fontes, leads, materiais e histórico em abas sem perder o
rascunho nem salvar automaticamente ao mudar de seção.

A composição de 29/09/2026 mantém a paleta aprovada. A implementação de
30/09/2026 conecta indicadores e dois gráficos a registros reais. O dashboard
abre no modo real; os exemplos exigem `?mode=demo` ou a rota de campanha de
demonstração. Nunca associar dados ilustrativos a uma campanha pelo nome.
Detalhes de captação, importação revisada e relatórios com histórico ficam na
campanha e em diálogos. Fontes não significam conexões OAuth de anúncios.
Ausência de medição deve aparecer como “ainda não medido”; zero só representa
zero medido. Contatos frios e cliques não são leads. Sem metas e cobertura
suficientes, não concluir que a operação está saudável. Contratos completos em `apps/chat-web/DESIGN.md` e
`compositionRecipes.marketingDashboard` no JSON.

## 9. Responsividade

Breakpoints Tailwind: sm 640, md 768, lg 1024, xl 1280 e 2xl 1536 px. A largura máxima do container é **1400 px**; isso não muda o breakpoint 2xl. Header existente: 64 px; rail desktop: 80 px a partir de md. Balões do mascote: lg+.

Para conteúdo novo:

1. Começar em uma coluna, preservando ordem de leitura e prioridades.
2. Adicionar colunas apenas quando conteúdo e controles couberem com folga.
3. Usar `min-w-0` nos filhos flex/grid e quebra segura para URLs, hashes e títulos longos.
4. Empilhar ações quando rótulos não couberem; não esconder a ação principal.
5. Testar 320, 390, 768, 1024 e 1440 px, zoom de texto de 200% e teclado virtual quando pertinente.
6. Confinar rolagem de código/tabela a uma região acessível. Não cortar menus, diálogos ou foco com `overflow-hidden` indiscriminado.
7. Não converter a refatoração visual em rearranjo de navegação ou alteração de fluxo sem escopo correspondente.

## 10. Acessibilidade e movimento

Meta para novas entregas: WCAG 2.2 AA. Isso é um critério de trabalho, não uma certificação global do sistema existente. Referências: [contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [contraste não textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [refluxo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

- Texto normal: pelo menos 4,5:1; texto grande: 3:1. Componentes essenciais e indicadores: 3:1 onde aplicável. Avaliar cores realmente compostas, inclusive opacidade, hover, gradientes e fundo.
- Foco visível em todos os controles; não o remover sem substituto equivalente. Usar landmarks, títulos em sequência e nomes acessíveis.
- Não depender só de cor, posição ou ícone. Alvos de toque novos: preferir 44 px. Mensagens de resultado também ficam visíveis e usam `aria-live` conforme urgência.
- Respeitar movimento reduzido. O CSS atual limita duração de animação e transição a 0,01 ms, uma iteração, rolagem automática. Não acrescentar movimento essencial sem alternativa.
- Usar transições curtas para feedback: composer 160 ms; accordion 200 ms. Para novos componentes, preferir 120–200 ms. Evitar brilho giratório contínuo e animações em áreas de leitura.
- Respeitar `forced-colors`; texto gradiente precisa de fallback sólido. Testar o resultado, não apenas a presença da media query.

## 11. Imagens, ícones e aplicações de marca

Usar Lucide nos controles do produto, com traço consistente e ícones normalmente de 16–20 px. Não misturar famílias visuais ou usar emoji como única representação de ação crítica. Imagem decorativa tem alt vazio; imagem informativa descreve seu conteúdo relevante.

Em peças institucionais, usar fundo midnight, assinatura original, título claro e uma ação principal. Fotografias e imagens de IA devem ter relação com tecnologia ampliando a capacidade humana, como no site; evitar clichês desconectados e excesso de elementos luminosos. Manter área calma para texto, sem sobreposição sobre detalhes de alto contraste. Não usar imagens externas sem autorização/licença adequada.

Aberturas podem ter mais espaço e tipografia maior que o sistema operacional. O manual demonstra uma composição editorial, não uma ordem para transformar formulários e tabelas em landing pages. Gráficos novos precisam de rótulos, legenda e padrões/traços distinguíveis; não inventar uma paleta categórica definitiva sem testar distinção e contraste.

## 12. Exemplos de implementação

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Dentro de um componente: saving, name e onSave vêm do fluxo real.
<form onSubmit={onSave} className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="campaign-name">Nome da campanha</Label>
    <Input id="campaign-name" name="name" defaultValue={name} required />
  </div>
  <Button type="submit" disabled={saving} aria-busy={saving}>
    {saving ? "Salvando…" : "Salvar campanha"}
  </Button>
</form>
```

```css
/* Fora deste monorepo: transportar os valores documentados e manter os papéis. */
.prometeus-panel {
  color: hsl(var(--card-foreground));
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 0.75rem;
  padding: 1.5rem;
}
```

Não copiar o CSS editorial do manual para substituir `src/index.css`. No monorepo, importar componentes existentes. Em outro projeto, adaptar as receitas à stack local mantendo tokens, acessibilidade e comportamento; a documentação não exige React fora deste produto.

## 13. Procedimento para qualquer agente IA

1. Ler as instruções do projeto, este documento, o JSON e o contrato de interação aplicável.
2. Identificar tela, público, objetivo e mudança solicitada. Separar requisito funcional de preferência estética.
3. Inspecionar componente e tokens existentes antes de criar novos. Não inferir APIs de componentes a partir de screenshots.
4. Definir anatomia e estados: normal, hover, foco, pressionado/selecionado, desabilitado, carregando, vazio, erro, sucesso e overflow, quando aplicáveis.
5. Implementar com tokens semânticos, composição responsiva e controles acessíveis.
6. Preservar dados, permissões e contratos. Não renomear headers, tenants, rotas, pastas ENS ou dados persistidos como efeito colateral de marca.
7. Validar em tamanhos móveis e desktop, teclado, foco, texto longo e movimento reduzido. Verificar os estados modificados no navegador.
8. Atualizar documentação quando houver nova decisão durável. Relatar arquivos alterados, verificações feitas e limitações reais.

Prompt portátil:

> Use a identidade Prometeus documentada em `docs/brandbook/`. Leia `design-system.md` e `design-system.json`, consulte `manual-da-marca.html` e os assets originais. Neste repositório, obedeça também ao `AGENTS.md` e a `apps/chat-web/DESIGN.md`. Reutilize tokens e componentes existentes; mantenha logos e mascote originais. Crie ou edite [objetivo] com os estados necessários, responsividade e acessibilidade. Preserve contratos de negócio. Diferencie valores implementados de recomendações e valide visualmente a entrega antes de concluir.

Não é preciso instalar uma skill ou MCP para ler este kit. O acervo O Setup foi consultado; o recurso Frontend Design já cobria composição e hierarquia, e as skills de marca/design system disponíveis foram reaproveitadas. Não foi criado um plugin paralelo.

## 14. Critérios de aceite e manutenção

- [ ] Nome Prometeus; arte original proporcional; robô preservado quando presente.
- [ ] Paleta oficial e tokens semânticos; nenhum azul, sombra ou raio arbitrário sem justificativa.
- [ ] Texto sólido legível; foco e estados com contraste verificado.
- [ ] Componentes reutilizados; todos os estados relevantes contemplados.
- [ ] Mobile sem overflow de página; desktop equilibrado; texto longo e zoom avaliados.
- [ ] Navegação por teclado, labels, foco de diálogo e anúncios funcionando.
- [ ] Movimento reduzido e modo de contraste forçado considerados.
- [ ] Nenhuma alteração indevida de IDs, autorização, dados ou confirmação de ações.
- [ ] JSON válido, aliases resolvidos e valores correspondentes ao CSS após mudanças de tokens.
- [ ] Manual, capturas e versão atualizados se a aparência de referência mudar.

Versionamento deste contrato: correções de texto sem alteração visual são patch; novas receitas compatíveis são minor; mudanças de paleta, tipografia, semântica ou componentes que exigem migração são major. Isso não equivale ao versionamento do pacote da aplicação.

Para validar mudanças no aplicativo, usar os comandos existentes de typecheck/build e testes relevantes. O cenário `e2e/prometeus-brand.spec.ts` cobre a identidade nas superfícies principais com fixtures locais. Documentação pura exige validação de JSON, links, assets, conteúdo e renderização; não exige alterar a lógica do produto.

O PDF original é referência histórica e permanece intacto. Este kit é a documentação da identidade digital aprovada em 26/09/2026. Evoluções futuras devem registrar data, justificativa e impacto sem apagar a origem das decisões.
