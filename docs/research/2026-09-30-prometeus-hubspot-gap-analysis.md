# Prometeus e HubSpot: lacunas funcionais e sequência de evolução

Data: 30 de setembro de 2026. Natureza: investigação de produto e leitura de código; não é homologação do ambiente em produção nem compromisso de implementação.

O Prometeus tem uma base de operação de marketing e execução assistida por IA. Para oferecer uma experiência comparável ao HubSpot, precisa acrescentar um CRM compartilhado, execução real nos canais, automação durável e gestão integrada de aquisição, vendas e relacionamento. A experiência deve continuar com a identidade Prometeus.

## Escopo e confiança das evidências

Foram consultados o conector HubSpot, documentação oficial pública, código local, migrations, contratos e documentos arquiteturais. O checkout contém trabalho em andamento; alterações locais e documentos recentes não comprovam disponibilidade na VPS. Não foram executados testes funcionais ou acessos administrativos à produção nesta investigação. As conclusões de ausência significam que não encontrei a capacidade no escopo inspecionado.

O conector confirmou leitura de contatos, empresas, negócios, tickets, atividades, formulários, segmentos, páginas, emails, produtos, propostas, faturas e assinaturas, com permissões diferentes por tipo. A conta conectada está com onboarding incompleto; campanhas exigem alteração da conta/plano e alguns objetos de pagamentos/contratos não estão disponíveis. O conector não permite inspecionar integralmente todas as telas, automações e funcionalidades Enterprise. Nenhum registro foi alterado e não foi feita análise dos resultados comerciais dessa conta.

Foram inspecionadas definições de propriedades, sem exportar dados pessoais:

- Contatos têm ciclo de vida, status de prospecção e origem de tráfego como conceitos separados.
- Negócios têm pipeline, etapa, previsão de fechamento e probabilidade.
- O pipeline configurado na conta vai de prospecção a contato inicial, qualificação, demonstração, proposta, negociação e encerramento ganho/perdido. Isso é configuração dessa conta, não uma exigência universal.

A referência é a plataforma ampla, incluindo capacidades Professional e Enterprise. Recursos variam por plano, assento, região e disponibilidade; funcionalidades em beta devem permanecer explicitamente separadas dos critérios de paridade. As páginas consultadas usam Smart CRM, Marketing Hub, Sales Hub, Service Hub, Content Hub, Data Hub, Revenue Hub e Agent Hub. Documentação e objetos ainda apresentam nomes históricos como Commerce e Breeze.

Fontes: [plataforma HubSpot](https://www.hubspot.com/products), [CRM e suas edições](https://www.hubspot.com/products/crm), [Sales Hub](https://www.hubspot.com/products/sales).

## O que o código atual sustenta

| Evidência local | Implicação para a comparação |
| --- | --- |
| `apps/chat-web/src/App.tsx` | As áreas funcionais inspecionadas são chat, administração de usuários e Marketing Ops. |
| `services/marketing-ops/src/domain/contracts.ts` | Campanhas têm briefing, público, oferta, canais e datas; itens têm responsáveis, prioridade e estados de produção. |
| `infra/postgres/migrations/0006_marketing_ops_core.sql` | Existem campanhas, participantes, materiais, dependências, conteúdo versionado, aprovações, auditoria, eventos e notificações. |
| `services/marketing-ops/src/plans/` | Planos preparados e execução estruturada constituem uma base reutilizável para operações assistidas por IA. |
| `infra/postgres/migrations/0019_marketing_ops_lead_ingestion.sql` e `services/marketing-ops/src/domain/leads*.ts` | Há desenvolvimento de fontes, contatos captados, participação em campanhas, importação, revisão e relatórios. A entrega completa precisa de integração e validação. |
| `apps/chat-web/src/lib/dashboard/model.ts` e `MarketingDashboardPage.tsx` | O dashboard inspecionado usa explicitamente demonstração; seu funil não comprova a existência de CRM ou receita integrada. |
| `CampaignOverview.tsx` | A visão inspecionada da campanha apresenta resultados ainda não medidos. |
| `docs/integrations/campaign-acquisition.md` | Descreve a fatia de captação e medição em andamento; informa que não ativa conectores de anúncios ou disparos. Documento não equivale a aceite funcional. |
| `services/app-api`, schemas IAM e documentação operacional | Sessões, tenants, papéis, BFF e procedimentos operacionais já constituem uma fundação. A comparação Enterprise demanda requisitos adicionais. |

Um item de produção com tipo `email` não comprova envio de email. Uma ação agendada no calendário não comprova publicação em rede social. Um clique em WhatsApp não comprova conversa ou lead identificado. Um relatório agregado de vendas não comprova oportunidades individuais, pagamentos ou atribuição de receita.

## Matriz de capacidades

Estados: **base existente** = implementação encontrada para uma parte útil da função; **parcial** = cobre parte do caso ou está em desenvolvimento; **demo** = simulação explícita; **não encontrada** = sem implementação identificada. Nenhum desses estados afirma paridade integral com HubSpot ou homologação atual na VPS.

As capacidades abaixo são requisitos propostos para o Prometeus a partir do benchmark. Podem ser entregues em camadas; não exigem copiar a interface ou os nomes de todos os objetos HubSpot.

### CRM e gestão do relacionamento

| Capacidade alvo | Estado observado | Trabalho necessário |
| --- | --- | --- |
| Base única de contatos por tenant | Parcial | Evoluir os contatos de captação para identidade de relacionamento compartilhada. |
| Empresas e múltiplos contatos por empresa | Não encontrada | Empresa como entidade, associações e papéis dos contatos. O campo textual `company` é insuficiente. |
| Registro de cliente com histórico completo | Não encontrada | Reunir campanhas, interações, atividades, negócios, tickets e contratos. |
| Ciclo de vida do contato | Não encontrada | Regras e histórico de lead, qualificado, oportunidade e cliente. |
| Estado de prospecção | Não encontrada | Separar tentativas, contato realizado, desqualificação e retomada do ciclo de vida. |
| Campos personalizados | Não encontrada | Tipos, validação, opções, campos obrigatórios e permissões. |
| Associações com papéis | Parcial | Generalizar os vínculos de campanhas para contato, empresa e negócio sem duplicar identidades. |
| Importação e deduplicação do CRM | Parcial | Reaproveitar prévia/revisão de captação; acrescentar edição, fusão controlada, histórico e importações de outros objetos. |
| Segmentos estáticos e dinâmicos | Não encontrada | Consultas por propriedades, comportamento e relações, atualizadas automaticamente. |
| Atividades de relacionamento | Não encontrada | Notas, emails, chamadas, reuniões, tarefas e próxima ação vinculados ao cliente. |
| Visões salvas e operações em lote | Parcial | Expandir padrões existentes para listas de CRM e papéis de equipes. |
| Objetos personalizados | Não encontrada | Considerar depois do CRM padrão e de casos reais que o justifiquem. |

O CRM compartilhado é a principal dependência dos demais módulos. A base precisa distinguir pessoa, empresa, relação com campanha e oportunidade. Uma pessoa pode participar de diversas campanhas e negócios sem ser contada como nova em cada importação. As permissões do CRM devem ser desenhadas explicitamente: dar acesso a uma campanha não autoriza automaticamente acesso a todo o histórico comercial do contato.

Referência: [Smart CRM](https://www.hubspot.com/products/crm), complementada pelas definições de schema e propriedades consultadas no conector.

### Marketing

| Capacidade alvo | Estado observado | Trabalho necessário |
| --- | --- | --- |
| Campanhas, briefing, canais e responsáveis | Base existente | Ampliar metas, orçamento, ativos e resultados reais. |
| Calendário, produção, dependências e aprovações | Base existente | Integrar entregas aprovadas à execução nos canais. |
| Fontes de captação, contatos e UTMs | Parcial | Concluir a fatia em andamento e validar captura até o dashboard. |
| Formulários editáveis e incorporáveis | Parcial | O adapter de captura não substitui editor, gestão de campos e publicações. |
| Editor e gestão de email marketing | Não encontrada | Templates, personalização, revisão, teste e envio real. |
| Preferências de comunicação e supressão | Não encontrada | Permissão de envio por finalidade/canal, descadastro, bloqueios e histórico. |
| Entregabilidade e eventos de envio | Não encontrada | Autenticação de domínio, bounces, reclamações, limites e eventos do provedor. |
| Nutrição e jornadas | Não encontrada | Fluxos acionados por eventos, regras, esperas e condições de saída. |
| Segmentação de audiência | Não encontrada | Ativar segmentos do CRM nos canais. |
| Lead scoring e passagem ao comercial | Não encontrada | Critérios de perfil e interesse, responsável e tempo de atendimento. |
| Integração com anúncios | Não encontrada | Contas externas, custos, métricas, leads e reconciliação. |
| Publicação social e medição | Não encontrada | Contas, aprovação, agendamento, publicação e retorno de métricas. |
| WhatsApp operacional | Parcial | Link/clique de captação em desenvolvimento; conversas exigem canal integrado, mensagens e webhooks. |
| Testes A/B | Não encontrada | Variantes, divisão de audiência, resultado e critérios comparáveis. |
| Gestão de eventos/webinars | Não encontrada | Inscrições, participação e vínculo com o relacionamento. |
| Marketing por contas-alvo | Não encontrada | Empresas-alvo, comitês de compra, segmentação e acompanhamento conjunto. |
| Resultados de campanha com dados reais | Parcial/demo | Conectar relatórios e eventos persistidos aos indicadores. |
| Atribuição de contato, oportunidade e receita | Não encontrada | Eventos, identidades, vínculos de negócios e modelos explicitamente definidos. |

Referências: [automação de marketing](https://www.hubspot.com/products/marketing/marketing-automation), [segmentos](https://www.hubspot.com/products/marketing/audience-segments), [atribuição em anúncios](https://knowledge.hubspot.com/ads/ads-attribution-in-hubspot), [atribuição de contatos, negócios e receita](https://knowledge.hubspot.com/reports/understand-attribution-reporting).

### Comercial

| Capacidade alvo | Estado observado | Trabalho necessário |
| --- | --- | --- |
| Pipelines e oportunidades reais | Não encontrada | Negócios com empresa/contatos, valor, etapa, responsável e datas. |
| Quadro e lista de oportunidades | Não encontrada | Filtros, movimentação, regras e histórico de transição. |
| Distribuição e fila de prospecção | Não encontrada | Critérios de atribuição, carga, território e próxima atividade. |
| Email individual conectado | Não encontrada | Sincronização e registro de comunicação autorizada. |
| Cadências comerciais | Não encontrada | Emails e tarefas individuais; interromper quando houver resposta ou encerramento. |
| Agenda de reuniões | Não encontrada | Disponibilidade, fuso, integração com calendário e cancelamento. |
| Ligações e inteligência de conversas | Não encontrada | Integração de telefonia, registro, transcrição e análise conforme configuração. |
| Playbooks e biblioteca comercial | Não encontrada | Roteiros, documentos e orientações vinculados às oportunidades. |
| Propostas e catálogo | Não encontrada | Produtos/serviços, itens, versões, descontos e aprovações. |
| Metas, forecast e desempenho | Não encontrada | Metas por equipe, probabilidade, período e revisão do pipeline. |
| Motivos de perda e tempo por etapa | Não encontrada | Eventos históricos e métricas que sobrevivam a mudanças de configuração. |
| Retorno ao marketing | Não encontrada | Informar qualidade, perda, venda e reativação por origem. |

Referência: [Sales Hub](https://www.hubspot.com/products/sales). As etapas devem refletir o processo comercial real do público do Prometeus; o pipeline observado na conta conectada é apenas um exemplo.

### Atendimento, sucesso do cliente e retenção

| Capacidade alvo | Estado observado | Trabalho necessário |
| --- | --- | --- |
| Caixa de entrada compartilhada | Não encontrada | Mensagens de canais conectados, atribuição e colaboração. |
| Chat com clientes no site | Não encontrada | Widget público e encaminhamento ao atendimento. O chat atual com Hermes é outro fluxo. |
| Tickets e pipelines de suporte | Não encontrada | Categorias, prioridade, estados, cliente e responsáveis. |
| SLAs e escalonamento | Não encontrada | Horários de trabalho, pausas, primeira resposta e resolução. |
| Roteamento de atendimento | Não encontrada | Regras por disponibilidade, equipe e habilidade. |
| Base de conhecimento publicada | Não encontrada | Artigos, busca, revisões e métricas de autoatendimento. |
| Portal do cliente | Não encontrada | Acesso restrito ao próprio histórico e tickets. |
| Pesquisas NPS/CSAT | Não encontrada | Coleta, periodicidade e associação ao relacionamento. |
| Onboarding de clientes | Não encontrada | Etapas, tarefas e passagem do comercial ao pós-venda. |
| Saúde da carteira | Não encontrada | Sinais definidos de uso, atendimento, relacionamento e renovação. |
| Renovação, expansão e risco de cancelamento | Não encontrada | Contratos, datas e oportunidades de retenção/expansão. |

Referências: [Service Hub](https://www.hubspot.com/products/service), [canais do help desk](https://knowledge.hubspot.com/help-desk/overview-of-the-help-desk-workspace), [SLAs](https://knowledge.hubspot.com/help-desk/set-sla-goals-in-help-desk).

### Conteúdo e presença digital

| Capacidade alvo | Estado observado | Trabalho necessário |
| --- | --- | --- |
| Materiais, conteúdo e versões de produção | Base existente | Reutilizar gestão e aprovações existentes. |
| Landing pages e templates | Não encontrada | Editor, publicação, domínio, formulário e resultados. |
| CMS, páginas e blog | Não encontrada | Conteúdo estruturado, templates, preview, revisão e publicação. |
| SEO e otimização para mecanismos de resposta | Não encontrada | Metadados, auditoria e sinais de visibilidade; tratar recursos emergentes separadamente. |
| Personalização por audiência | Não encontrada | Regras conectadas ao CRM e às preferências de comunicação. |
| Reaproveitamento multiformato com IA | Parcial | O agente pode apoiar criação; falta um fluxo integrado e mensurável de transformação e distribuição. |
| Conteúdo restrito, múltiplos sites e idiomas | Não encontrada | Acrescentar conforme demanda após editor e publicação básicos. |

Referência: [Content Hub](https://www.hubspot.com/products/content). A marca do Prometeus continua regida por `docs/brandbook/` e pelos contratos do produto; o benchmark funcional não autoriza trocar logos, fontes ou mascote.

### Receita, cobrança e operação de dados

| Capacidade alvo | Estado observado | Trabalho necessário |
| --- | --- | --- |
| Proposta aceita ligada à venda | Não encontrada | Separar proposta, negócio ganho, contrato e recebimento. |
| Assinatura, contratos e renovação | Não encontrada | Versões, aceite, vigência e evidências recebidas da integração. |
| Faturas, pagamentos e links | Não encontrada | Provedor integrado e reconciliação por eventos. |
| Assinaturas recorrentes | Não encontrada | Cobrança, status, falhas, cancelamentos e alterações. |
| Métricas de receita recorrente | Não encontrada | Definições de MRR/ARR, expansão, contração e cancelamento. |
| Sincronização e mapeamento externo | Não encontrada como produto geral | Credenciais por tenant, direção da sincronização e conflitos. |
| Qualidade e enriquecimento dos dados | Parcial | Expandir revisão de contatos para regras, monitoramento e procedência. |
| Datasets e relatórios configuráveis | Não encontrada | Camada semântica, relações, filtros e definições de métricas. |
| API pública e webhooks para integrações | Parcial | Os endpoints internos/BFF existentes não equivalem a plataforma pública versionada. |
| Catálogo e gestão de integrações | Não encontrada | Permissões, status, reconexão e diagnóstico por cliente. |

Referências: [Revenue Hub](https://www.hubspot.com/products/revenue?rd=1), [configuração de propostas](https://knowledge.hubspot.com/quotes/set-up-quotes), [Data Hub](https://www.hubspot.com/products/data), [sincronização](https://knowledge.hubspot.com/integrations/connect-and-use-hubspot-data-sync), [extensibilidade](https://developers.hubspot.com/automate-data).

Paridade em cobrança deve considerar os países e métodos usados pelos clientes do Prometeus. Integração com meios locais e operação fiscal exige análise própria; uma fatura de cobrança não deve ser tratada automaticamente como documento fiscal brasileiro.

### Administração, experiência e IA

| Capacidade alvo | Estado observado | Trabalho necessário |
| --- | --- | --- |
| Sessões, usuários, tenants e papéis | Base existente | Evoluir permissões por módulo, equipe, carteira e campo. |
| Auditoria de alterações e execução da IA | Base existente no domínio inspecionado | Unificar nos novos módulos e oferecer consulta adequada ao gestor. |
| SSO/MFA e provisionamento | Não encontrados nesta inspeção | Definir requisitos conforme o público Enterprise. |
| Preferências, exportação e retenção | Parcial | Transformar requisitos operacionais em gestão do ciclo de vida dos dados. |
| Sandbox de configurações do produto | Não encontrada | Testar automações e alterações antes de ativá-las; distinto do ambiente de desenvolvimento. |
| Onboarding e configuração sem código | Parcial | Assistentes para equipes, dados, canais, pipelines e metas. |
| Busca global, filtros e produtividade | Parcial | Reutilizar padrões e acrescentar consistência entre os módulos. |
| Uso móvel e aplicativo dedicado | Parcial | A interface possui comportamento responsivo; paridade móvel requer validação dos novos fluxos. Aplicativo dedicado não encontrado. |
| Copiloto com planos revisáveis | Base existente | Expandir ferramentas autorizadas para CRM, vendas e suporte. |
| Agentes especializados e ações contextuais | Parcial | Ferramentas de domínio, escopo explícito e observação de resultados. |
| Conhecimento e resposta fundamentada | Parcial | Base publicada/autorizada e referências verificáveis por tarefa. |
| Gestão de desempenho e custo da IA | Parcial | Avaliações, taxa de sucesso, escalonamento, limites e custo por resultado. |

Referências: [edições do CRM](https://www.hubspot.com/products/crm), [sandbox](https://knowledge.hubspot.com/account-management/deploy-sandbox-changes-to-production), [Agent Hub](https://www.hubspot.com/products/artificial-intelligence).

## As fundações que precisam ser compartilhadas

1. **Identidade do cliente e associações.** Contatos e empresas comuns aos módulos, preservando origem e histórico. A evolução da tabela de leads exige desenho e migração próprios, não duplicação apressada nem renomeação geral.
2. **Eventos de negócio.** Recebimento de formulário, envio, resposta, mudança de etapa, aceite e pagamento têm IDs e datas verificáveis. Eventos alimentam automação e medição; a timeline visual é uma projeção desses dados.
3. **Automação durável.** Regras, esperas, ramificações, entradas e saídas; versões e cancelamento; reexecução segura, falhas visíveis e idempotência. Aproveitar eventos e idempotência existentes. Um cron ou prompt isolado não cobre essa função.
4. **Integrações operáveis.** Conexão por tenant, segredos no servidor, permissões mínimas, callbacks, webhooks verificados, limites de API, retomada, reconciliação e visibilidade de última atualização.
5. **Métricas com significado.** Separar contato novo, lead captado, qualificado, negócio ganho, receita contratada e pagamento recebido. Separar origem, influência e crédito atribuído; não somar a mesma receita por cada campanha relacionada.
6. **Configuração acessível.** Gestor define campos, filtros, pipelines, metas, templates e automações dentro do produto. Cada pequena alteração de processo não deveria depender de edição de código.
7. **Operação e qualidade.** Backups com recuperação, controle de acesso, logs e métricas já existentes precisam crescer junto com o produto. Carga, disponibilidade, acessibilidade e manutenção de conectores fazem parte da entrega.

O desenho permanece dentro da arquitetura aceita: navegador → App API/BFF → serviços de domínio/PostgreSQL/Artifact Server; Chat Bridge → Hermes oficial na rede interna. Autorizações pertencem à aplicação. Extensões do agente ficam em `agents/ens`; não há motivo funcional para vendorizar Hermes ou introduzir Supabase, Graph MCP ou Neo4j. A topologia de filas e workers deve ser definida em ADR quando a fatia de automação for detalhada.

## Sequência recomendada e critérios de aceite

| Marco | Entregas principais | Critério de aceite funcional |
| --- | --- | --- |
| 1. Captação e medição confiáveis | Concluir fontes, importação, revisão, formulário e resultados reais. | Captar/importar uma pessoa, revisar duplicidade e conferir o resultado persistido na campanha; ausência de dado aparece como desconhecida. |
| 2. CRM compartilhado e comercial básico | Contatos, empresas, histórico, oportunidades, pipeline, tarefas e responsáveis. | A mesma pessoa participa de duas campanhas e de uma oportunidade sem duplicação; registrar ganho/perda preserva origem e histórico. |
| 3. Marketing executável | Segmentos, preferências de comunicação, um canal de envio e automação inicial; anúncios e social conforme prioridade. | Captura inicia jornada publicada; resposta/descadastro interrompe ações quando previsto; falha fica visível e replay não duplica envio. |
| 4. Vendas e análise integradas | Cadências, reuniões, propostas, forecast e atribuição inicial. | Lead passa ao vendedor, gera proposta e negócio; o painel permite rastrear o valor até os registros usados na métrica. |
| 5. Atendimento e receita | Inbox, tickets, SLAs, onboarding, contratos e cobrança conforme público. | Uma venda alimenta o pós-venda; ticket e renovação compartilham contexto; recebimento difere de venda contratada. |
| 6. Profundidade Enterprise | Configurações avançadas, relatórios, governança, sandbox, extensibilidade e avaliações de agentes. | Equipes configuram e testam processos, com permissões e auditoria, sem acesso indevido e sem depender de mudança de código para cada regra. |

Landing pages e templates básicos podem entrar no marco 1 ou 3 quando forem uma necessidade de aquisição. CMS completo, objetos personalizados e amplitude de marketplace têm dependências próprias e podem vir depois. A prioridade dos canais depende de quais realmente geram relacionamento e receita para o público escolhido.

O primeiro alvo verificável é uma operação de marketing e vendas de ponta a ponta: captar → identificar → qualificar → distribuir → acompanhar → vender → medir. Depois, ampliar para atender, reter, renovar e receber. Isso oferece valor antes de tentar reproduzir toda a extensão da plataforma.

## Construir, integrar e reaproveitar

Manter sob controle do Prometeus: identidade do cliente, relações, autorização, configurações, experiência, métricas e histórico. Integrar provedores para transporte de mensagens, anúncios, calendários, telefonia, assinatura e pagamentos, com contratos claros de retorno de eventos. Gerar rascunhos e planos com IA; executar por serviços e regras verificáveis.

Conforme `AGENTS.md`, o acervo O Setup foi consultado por `search_resources` e `recommend_for_project`; os candidatos abaixo foram inspecionados com `get_resource`:

| Recurso do acervo | Área para avaliação posterior | Decisão nesta investigação |
| --- | --- | --- |
| [Twenty](https://setup.omatheusdaia.com.br/ferramentas/twenty) | CRM | Referência potencial; adotar outro CRM como autoridade exige comparar integração, permissões, licença e arquitetura. |
| Notifuse (`tool:notifuse`) | Email | Candidato a componente especializado; não avaliado tecnicamente para o Prometeus. |
| Postiz (`tool:postiz`) | Publicação social | Candidato a integração; não adotado nem instalado. |
| Documenso (`tool:documenso`) | Assinatura | Candidato a integração; requisitos técnicos e de aceite precisam de avaliação própria. |

Esses candidatos foram encontrados no acervo; não são recomendações de adoção. Não foi criada skill, instalado plugin ou definida ferramenta nova. A seleção técnica futura deve verificar as fontes oficiais, custos, limites, licença, isolamento por tenant e compatibilidade com a autoridade de dados do Prometeus.

## Esforço e definição de paridade

São três objetivos diferentes: cobrir os processos cotidianos de um público definido; oferecer amplitude funcional semelhante às edições Professional; reproduzir profundidade Enterprise e ecossistema. Cada nível amplia bastante o trabalho e a manutenção contínua.

Não há base para informar um percentual de paridade, prazo ou orçamento confiável nesta inspeção. Uma estimativa deve considerar equipe, volume de contatos/mensagens, canais, carga, clientes atendidos, customização e nível de disponibilidade. O planejamento precisa incluir produto/design, desenvolvimento, dados/integrações, QA e operação — funções que podem ser acumuladas, mas cujas responsabilidades continuam necessárias.

Medir progresso por jornadas aprovadas e capacidades em uso. Uma funcionalidade só conta como entregue quando dados persistidos, permissões, canal real ou simulador de contrato, falhas, experiência e observabilidade foram validados no escopo correspondente. Preservar o estilo Prometeus é compatível com a mesma riqueza funcional.
