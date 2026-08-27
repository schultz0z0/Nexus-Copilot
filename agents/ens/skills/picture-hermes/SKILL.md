---
name: picture-hermes
description: Planejar, gerar e revisar peças visuais complexas no modo Picture-Hermes com workspace persistente e tools nexus_picture.
version: 1.4.0
---

# Picture-Hermes

## Escopo e autoridade

Use este skill somente quando a mensagem de sistema identificar uma sessão marcada como Picture-Hermes, fornecer o `workspace_id` atual e uma delegação `nexus_picture`. No chat normal, ignore este skill e mantenha o gerador de imagem padrão do Hermes.

Hermes é o planner. O Picture executa o pipeline e publica a peça. A entrega continua sendo uma **imagem**, mesmo quando competências de copy, direção de arte, diagramação ou identidade de marca auxiliam o planejamento.

- Nunca use `image_generate` neste modo.
- Nunca transforme o pedido em PPTX, slide, deck, página web ou documento.
- Copy serve para mensagem, hierarquia verbal e CTA; não define outro tipo de artefato.
- Layout serve para composição da imagem; regras próprias de apresentações não se aplicam.
- Carregue `nexusai-ens-design-system` para obter os tokens oficiais da ENS (paleta, tipografia, espaçamento, logos e identidade). Use-o como fonte de marca, não como roteador de entrega.
- Não coloque emoji na peça e não invente ícones decorativos, salvo pedido ou aprovação explícita do usuário.
- Não invente preço, data, texto legal, oferta, logo ou atributo da marca.

Você pode planejar, iniciar, revisar e consultar jobs. Você não é a autoridade de aprovação: não aprove e não resete workspaces. Aprovação e criação de nova peça são ações explícitas do usuário na interface.

## Fluxo obrigatório

1. Chame `picture_get_workspace` antes de planejar uma revisão ou afirmar o estado atual.
   Copie cada `relative_path` necessário exatamente do manifest retornado. Nunca reconstrua, translitere, normalize ou adivinhe o nome de referência.
2. Reúna no chat somente o briefing que estiver faltando. Não peça ao usuário nomes de tools, IDs, JSON ou detalhes internos.
   Quando um curso ENS estiver identificado, consulte `ens_rag_get_course_context` (ou `ens_rag_search` quando necessário) e combine o contexto oficial com os tokens do `nexusai-ens-design-system`, inclusive o KV específico quando disponível.
3. Escolha a técnica e o menor pipeline capaz de entregar a direção aprovada. Preserve referências reais de produto e logos com composição determinística.
4. Na primeira geração, envie `workspace_id`, `CreativeBrief`, `CompositionPlan`, `reference_artifact_ids` e `idempotency_key` completos a `picture_start_job`, uma única vez, com chave de idempotência estável no turno.
5. Para alterações após existir uma candidata, consulte o workspace, produza novamente um plano completo e chame `picture_revise` com `workspace_id`, `revision_request`, `composition_plan` e `idempotency_key`.
6. Consulte `picture_get_job` sempre com `workspace_id` e `job_id` para o estado real. Não invente progresso, artefatos ou conclusão.
7. Em `succeeded`, informe que a candidata está pronta para revisão humana. Somente o estado `validated` significa peça aprovada.

O caminho feliz da primeira geração é `picture_get_workspace` → `picture_start_job` → `picture_get_job`. Use sempre o `workspace_id` literal fornecido pela mensagem de sistema; nunca envie o objeto `workspace_atual` no lugar da string. Depois que `picture_start_job` aceitar o job, não o repita: consulte somente `picture_get_job` até um estado terminal.

## Regra crítica de serialização

As chamadas MCP usam **objetos e arrays JSON nativos**. Nunca escreva XML, `<item>`, tags por tipo de overlay, atributos `type="array"` ou JSON convertido em string.

- `composition_plan.pipeline` é um array JSON.
- Cada passo é um objeto do array e possui exatamente um `op`.
- Em um passo `compose`, `overlays` é outro array JSON; cada overlay é um objeto irmão dentro desse array.
- Em geral, reúna os overlays determinísticos em um único `compose`. Use vários passos somente quando o resultado intermediário realmente alimentar o próximo passe.
- Use `templates/picture-start-deterministic.json` como forma canônica quando o pedido for determinístico ou o FAL estiver indisponível. Use `templates/picture-start-job.json` somente quando o pipeline generativo estiver autorizado. Substitua valores, não a forma dos arrays.
- `depth` aceita somente `background`, `midground`, `foreground`, `overlay` ou `frame`.

## CreativeBrief completo

Forneça todos os campos:

- `title`, `campaign_type`, `channel`;
- `objective`, `audience`, `offer`;
- `copy_points`: array de textos obrigatórios em ordem de hierarquia;
- `cta`: chamada exata;
- `visual_style` e `brand_profile`;
- `output`: `width`, `height` e `format` (`png`, `jpg` ou `webp`).

## CompositionPlan completo

Use `version: 1`, `base_prompt`, `pipeline` e um `final_path` seguro sob `final/`.

Operações aceitas:

- `generate`: `prompt`; opcionais `model`, `size`, `platform`.
- `edit`: `prompt`; opcionais `model`, `assets` (array), `size`.
- `remove-bg`.
- `replace-bg`: `prompt`; `model` opcional.
- `crop`: `size`; `position` opcional.
- `grade`: `name` (`cinematic`, `moody`, `vibrant`, `clean`, `warm-editorial`, `cool-tech`).
- `grain`: `intensity` opcional entre 0 e 1.
- `vignette`: `opacity` opcional entre 0 e 1.
- `text`: `title`; opcionais `font`, `color`, `fontSize`, `zone`.
- `compose`: `overlays` (array nativo) ou `overlays_file`; `size` define o canvas quando `compose` é a primeira operação.
- `upscale`: `scale` opcional de 2 a 4.

Modelos: `flux-schnell` para rascunhos/fundos rápidos; `flux-dev` ou `imagineart` para hero com qualidade; `recraft-v3` para visual gráfico; `kontext`/`reve-fast` para edições; `seedream` para compor várias referências; `banana2`/`banana-pro` quando preservação ou complexidade justificar custo maior.

### Overlays de `compose`

Cada objeto exige `type`:

- `gradient-overlay`: `gradient`; opcionais `opacity`, `blend`, `depth`.
- `shape`: `shape` (`rect`, `circle`, `line`, `arrow`); opcionais `zone`, dimensões, cores, borda, pontos, `anchor`, `rotation`, `allowBleed` e `depth`.
- `satori-text`: `jsx`; opcionais `zone`, dimensões, `anchor`, `opacity`, `depth`.
- `image`: `src` relativo ao workspace; opcionais posição, dimensões, `anchor`, `opacity`, raio, rotação, `allowBleed` e `depth`.
- `watermark`: `src`; opcionais `position`, `margin`, `opacity`, `size`, `depth`.

Zonas nomeadas incluem `hero-center`, `title-area`, `top-bar`, `bottom-bar`, `left-third`, `right-third`, cantos safe e centros laterais. Uma coordenada numérica exige unidade explícita: `{ "x": 72, "y": 80, "unit": "px" }` ou `{ "x": 7, "y": 82, "unit": "percent" }`. Nunca envie apenas `{ "x", "y" }`.

`anchor` descreve qual ponto do elemento coincide com a zona: use `top-left` quando `x/y` representam a margem esquerda/superior e `center` quando representam o centro. `allowBleed: true` é permitido somente para imagem ou forma decorativa que deva sangrar intencionalmente; texto nunca deve ultrapassar o canvas. Em compose-first, `compose.size` deve ser igual a `creative_brief.output`.

Para texto preciso, use `satori-text`; preserve o texto literalmente. O `jsx` raiz deve ser sempre um nó JSON `{ "tag", "props", "children" }`; strings são permitidas apenas dentro de `children`. Nunca envie HTML, código JSX ou `style={{...}}` em uma string. Não peça ao modelo generativo para reconstruir logos. Para referências, use somente paths relativos presentes no manifest, normalmente sob `references/`, copiados byte a byte. Nunca use path absoluto, `..` ou barra invertida.

Em overlays `image`, use `fit` (`cover`, `contain`, `fill`, `inside` ou `outside`) e `position` (`center`, `left`, `right`, `top`, `bottom`, `attention` ou `entropy`) quando a proporção ou o foco importarem. Use `contain` para preservar integralmente referência/logo e `cover` somente quando o corte for seguro. Em `shape` do tipo `line` ou `arrow`, sempre forneça `from` e `to`.

## Receita KV para fundos

### Referência fotográfica disponível

1. Use a referência como primeiro overlay `image`, em `depth: "background"`, com o `src` exato do manifest.
2. Preserve logo, pessoa e elementos essenciais escolhendo `fit` e `position`; se o usuário pediu para manter a referência, não a substitua por formas genéricas.
3. Se a referência ainda não tiver uma faixa de leitura adequada, aplique em seguida `gradient-overlay`: cor primária do KV na área de texto e transparente sobre a pessoa/produto. Se a referência já trouxer o degradê desejado, não o duplique. Se houver logo embutida sob a área do degradê, mantenha a opacidade suficiente para a logo continuar legível. Para texto à esquerda, use como ponto de partida `linear-gradient(90deg, rgba(PRIMARIA,0.78) 0%, rgba(PRIMARIA,0.64) 38%, rgba(PRIMARIA,0.14) 68%, rgba(PRIMARIA,0) 100%)` e ajuste ao asset real.
4. Componha texto/CTA com nós JSON Satori e não duplique uma logo já embutida na referência.

Use `templates/picture-revise-reference.json` como forma canônica dessa revisão.

### Sem referência e sem crédito FAL

Use `compose` como primeira e única operação: gradiente multistop com as cores oficiais do KV, área negativa para leitura e no máximo duas formas de apoio do design system. Não invente fotografia ou persona. Evite o fundo creme genérico quando o KV recuperado indicar outra direção.

### Com crédito FAL

Use FAL somente para criar cenário, textura, fotografia ou persona sem texto, logo, CTA ou elementos legais. O prompt deve reservar a área negativa definida pelo layout e usar o contexto visual do curso. Depois aplique localmente o degradê KV, tipografia, logo e CTA. Assim, a camada generativa complementa o KV; ela não substitui a composição determinística.

## Qualidade visual

- Uma mensagem principal, hierarquia clara e no máximo três tamanhos tipográficos.
- Em canvas de 1080 px, evite texto abaixo de 36 px para leitura móvel.
- Mantenha safe area mínima de 5%, contraste e CTA legível.
- Prefira `generate -> crop/grade -> compose` para preservar cores e tipografia da marca na camada final.
- Use geração para cenário/ilustração e composição determinística para textos, logos, selos, formas e gradientes.
- Quando o usuário pedir modo determinístico ou não houver crédito FAL, use somente operações locais e comece por `compose` com `size`; não inclua `generate`, `edit`, `remove-bg`, `replace-bg` ou `upscale`.
- Em edição generativa, descreva o que deve permanecer idêntico.

## Estados e revisões

- `drafting`: briefing/plano em construção.
- `generating`: job enfileirado ou executando.
- `review`: candidata disponível para avaliação humana.
- `validated`: peça aprovada e preservada em Trabalhos Validados.
- `failed`: explique o erro retornado e corrija o plano; a candidata anterior pode permanecer válida.
- `resetting`/`closed`: não inicie job; aguarde a interface criar o próximo workspace.

Nunca exponha `delegation_token`, chaves internas ou detalhes de autenticação na resposta.
