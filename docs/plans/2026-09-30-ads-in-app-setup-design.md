# Proposta: preparo dos aplicativos Ads pelo app

Status: aprovado pelo responsável em 30/09/2026; implementação em andamento.
Adendo aprovado: permitir trocar o aplicativo configurado e a conta conectada,
preservando histórico e exigindo nova autorização quando o aplicativo mudar.

## Problema observado

O usuário encontra os três provedores em Integrações, mas só consegue ler
orientações. A interface omite Conectar quando a configuração operacional está
ausente. O backend já oferece autorização OAuth, seleção de conta e sincronização;
falta um caminho no produto para preparar o aplicativo da empresa.

A empresa continua proprietária dos aplicativos Meta, Google e LinkedIn, como
aprovado anteriormente. Não haverá aplicativo central da Prometeus nem tokens
compartilhados entre instalações.

## Alternativas

1. **Assistente administrativo dentro do app — recomendada.** O administrador
   cadastra o aplicativo da empresa uma vez; gestores autorizam e escolhem contas.
   Exige implementar gravação segura e atualização da configuração no servidor,
   mas permite concluir o preparo sem editar Docker ou arquivos manualmente.
2. **Instalação entregue pré-configurada.** O operador continua preparando os
   aplicativos antes da entrega e o usuário só autoriza. É mais simples, mas
   depende do operador para corrigir ou trocar a configuração e mantém a lacuna
   observada neste localhost.

## Experiência proposta

Cada provedor tem uma ação visível, inclusive antes do preparo:

- Sem aplicativo: **Configurar aplicativo**, para administrador. Os demais
  usuários recebem orientação clara de que precisam do administrador.
- Aplicativo preparado: **Conectar Meta Ads**, **Conectar Google Ads** ou
  **Conectar LinkedIn Ads**, para os papéis já autorizados a gerir conexões.
- Autorização recebida: **Escolher conta**; não declarar conectado antes da
  seleção e validação real.
- Conta conectada: conta, capacidades e ações existentes de gestão.

O assistente mostra três etapas: **Aplicativo → Autorização → Conta**. Salvar
credenciais conclui somente a primeira. É possível cancelar sem alterar a
configuração vigente. Dados inválidos apontam o campo correspondente, sem
reproduzir o segredo na mensagem.

### Cadastro do aplicativo

Mostrar primeiro instruções específicas de onde obter os identificadores, uma
URL de retorno calculada pelo servidor e um botão para copiá-la. A criação e
aprovação do aplicativo continuam ocorrendo no provedor; o Prometeus não pode
dispensar esse requisito de aplicativos próprios.

| Provedor | Campos principais |
| --- | --- |
| Meta | ID do aplicativo, segredo do aplicativo, ID da configuração de Login for Business |
| Google | Client ID, Client Secret |
| LinkedIn | Client ID, Client Secret |

Permissões, versão da API e eventual conta gestora Google ficam em detalhes
avançados, com configuração inicial apropriada à versão entregue. A tela não
exige senha pessoal do Google, Facebook ou LinkedIn nem tokens copiados pelo usuário.

O segredo é um campo de senha somente para envio. Ao reabrir o formulário,
mostrar **Segredo cadastrado**, nunca o valor existente. Uma substituição deve
ser explícita; campo vazio não apaga um segredo salvo.

### Autorização e conta

Depois de salvar, oferecer **Continuar e autorizar**. Usar o fluxo OAuth e a
seleção de conta existentes, mantendo cancelamento, sessão, estado de uso único,
controle de versões e capacidades independentes. Resultados de erro não podem
ser confundidos com autorização concluída.

Vínculos de campanhas, resultados e importação humana permanecem nos locais
atuais. Cadastrar um aplicativo não cria pessoas nem resultados de campanhas.

## Servidor e persistência

Preservar Browser → BFF → Marketing Ops e a autorização canônica da aplicação.
Adicionar endpoints administrativos de leitura de metadados e gravação de
configuração. A API nunca devolve segredos; consultas comuns de estado não
recebem os campos administrativos.

Credenciais permanecem em armazenamento privado da instalação no servidor,
conforme a fronteira existente. O pacote de infraestrutura provisiona um volume
privado persistente e a chave própria da instalação; o usuário não precisa
criar arquivos de segredo ou editar Compose para usar o assistente. A chave não
é digitada nem exibida na interface. Backup e recuperação continuam documentados
para o operador humano.

A implementação deve validar e gravar arquivos de forma atômica, sem caminhos
fornecidos pelo navegador, com permissões restritas e preservação após reinício.
Configuração já gerenciada externamente deve ser identificada e tratada
explicitamente, sem sobrescrever arquivos operacionais silenciosamente.

Publicar uma nova configuração exige atualização consistente dos clientes do
provedor no processo. Trocar aplicativo, segredo ou permissões invalida estados
OAuth e operações da configuração anterior; requer nova autorização e conserva
o histórico. As barreiras existentes de versão da conexão devem continuar
protegendo callbacks e sincronizações em andamento.

O cadastro pertence a esta instalação. Autorização de administrador no banco
não pode permitir que um ator altere credenciais de outra instalação. Auditoria
registra ator, provedor e operação, sem valores secretos ou corpos de requisição.
Hermes não recebe nem modifica credenciais por planos.

## Apresentação e validação

Usar o brandbook e os componentes existentes: página limpa, formulário em
diálogo/assistente, campos específicos do provedor e detalhes avançados recolhidos.
Preservar comportamento móvel, foco, teclado e alvos de 44 px.

Critérios de aceite:

1. Uma instalação nova oferece uma ação para começar o preparo dentro do app.
2. Somente administrador cadastra/substitui o aplicativo; gestores mantêm o
   direito existente de autorizar contas.
3. Segredos não aparecem em respostas, logs, localStorage, bundles ou Hermes.
4. Salvar não implica conexão ativa e mostra o próximo passo de autorização.
5. Configuração válida persiste após reinício; erro de gravação conserva a anterior.
6. Trocar aplicativo não aceita callbacks/jobs iniciados na configuração anterior.
7. Cancelamento e erros de validação permitem corrigir ou retomar o assistente.
8. Desktop/mobile permitem completar preparo, autorização e seleção de conta.
9. Validação com contas reais continua necessária para cada provedor.

## Escopo da execução

Implementar e testar no ambiente local autorizado. Atualizar contratos,
AGENTS.md, guia de instalação e manual de validação quando a proposta for
aprovada e implementada. Nenhuma operação direta na VPS; preparo/deploy em
produção continuam com o operador humano.
