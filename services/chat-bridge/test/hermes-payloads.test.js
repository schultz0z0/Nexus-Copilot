import assert from "node:assert/strict";

import test from "node:test";



import {

  buildHermesRunInput,

  buildHermesSessionChatRequest,

  buildHermesResponsesRequest,

  buildHermesResponsesInput,

  isNexusHumanizerResponseContractEnabled,

  isNexusMarketingOpsOperatorContractEnabled,

  isNexusMemoryRoutingContractEnabled,

  NEXUS_HUMANIZER_RESPONSE_CONTRACT,

  NEXUS_MEMORY_ROUTING_CONTRACT,

  selectHermesBridgeMode,

  shouldUseResponsesApi,

} from "../src/hermes-payloads.js";



test("buildHermesResponsesInput sends image attachments as multimodal image parts", () => {

  const input = buildHermesResponsesInput({

    messageText: "analise esta imagem",

    attachments: [{

      kind: "image",

      name: "layout.png",

      mime_type: "image/png",

      storage_path: "user-1/session-1/layout.png",

      signed_url: "https://project.supabase.co/storage/v1/object/sign/chat-attachments/user-1/session-1/layout.png?token=abc",

      inline_data_url: "data:image/png;base64,AAAA",

    }],

    imageTransport: "inline",

  });



  assert.equal(input.length, 1);
  assert.equal(input[0].role, "user");
  assert.equal(input[0].content.length, 2);
  assert.equal(input[0].content[0].type, "input_text");
  assert.match(input[0].content[0].text, /analise esta imagem/);
  assert.match(input[0].content[0].text, /Contrato Nexus Humanizer/);
  assert.match(input[0].content[0].text, /Contrato Nexus de memoria nativa/);
  assert.deepEqual(input[0].content[1], { type: "input_image", image_url: "data:image/png;base64,AAAA" });







});



test("buildHermesRunInput includes extracted file text for long running text runs", () => {

  const input = buildHermesRunInput({

    messageText: "resuma",

    attachments: [{

      kind: "file",

      name: "brief.txt",

      mime_type: "text/plain",

      storage_path: "user-1/session-1/brief.txt",

      signed_url: "https://project.supabase.co/storage/v1/object/sign/chat-attachments/user-1/session-1/brief.txt?token=abc",

      extracted_text: "conteudo do brief",

    }],

  });



  assert.match(input, /resuma/);

  assert.match(input, /\[Arquivo: brief\.txt\]/);

  assert.match(input, /conteudo do brief/);

});



test("buildHermesRunInput includes replayed chat history before current text", () => {

  const input = buildHermesRunInput({

    messageText: "oque eu falei antes mesmo?",

    attachments: [],

    replayContextMessages: [

      { role: "user", messageText: "Eu falei que meu código secreto é abacaxi azul.", attachments: [] },

      { role: "assistant", messageText: "Entendido. Vou considerar que o código secreto é abacaxi azul.", attachments: [] },

    ],

  });



  assert.match(input, /Mensagem anterior do usuario: Eu falei que meu código secreto é abacaxi azul\./);

  assert.match(input, /Resposta anterior do assistente: Entendido/);

  assert.ok(input.includes("[Mensagem atual do usuario]"));
  assert.ok(input.includes("oque eu falei antes mesmo?"));
});



test("selectHermesBridgeMode routes every chatbot turn through persisted Hermes sessions", () => {

  assert.equal(selectHermesBridgeMode([]), "session");

  assert.equal(selectHermesBridgeMode([{ kind: "file", mime_type: "text/plain", extracted_text: "ok" }]), "session");

  assert.equal(selectHermesBridgeMode([{ kind: "image", mime_type: "image/png" }]), "session");

});



test("buildHermesSessionChatRequest leaves conversation continuity to Hermes SessionDB", () => {

  const request = buildHermesSessionChatRequest({

    messageText: "qual e minha cor escolhida?",

    attachments: [],

    replayContextMessages: [

      { role: "user", messageText: "Minha cor escolhida e vermelho.", attachments: [] },

      { role: "assistant", messageText: "Entendido.", attachments: [] },

    ],

  });



  assert.equal(typeof request.message, "string");

  assert.match(request.message, /qual e minha cor escolhida\?/);

  assert.match(request.message, /Memoria Hermes nativa permanece ativa/);

  assert.doesNotMatch(request.message, /Minha cor escolhida e vermelho/);

});

test("Picture session preloads only the Picture planner and ENS brand contract", () => {
  const request = buildHermesSessionChatRequest({
    messageText: "Crie uma peça quadrada",
    attachments: [],
    experience: "picture",
    pictureWorkspaceId: "11111111-1111-4111-8111-111111111111",
    pictureDelegation: "header.payload.signature",
  });

  assert.deepEqual(request.skills, ["picture-hermes", "nexusai-ens-design-system"]);
  assert.match(request.system_message, /entrega continua sendo uma imagem/i);
  assert.match(request.system_message, /emoji/i);
  assert.match(request.system_message, /relative_path.*manifest/i);
  assert.match(request.system_message, /satori-text.*JSON/i);
  assert.match(request.system_message, /RAG.*KV.*curso/i);
  assert.doesNotMatch(request.system_message, /use.*pptx/i);
});

test("buildHermesSessionChatRequest keeps delegation out of persisted user history", () => {
  const delegation = "header.payload.signature";
  const request = buildHermesSessionChatRequest({
    messageText: "liste minhas campanhas",
    attachments: [],
    marketingOpsDelegation: delegation,
  });

  assert.doesNotMatch(request.message, /MARKETING_OPS_DELEGATION/);
  assert.doesNotMatch(request.message, new RegExp(delegation.replaceAll(".", "\\.")));
  assert.match(request.system_message, /MARKETING_OPS_DELEGATION/);
  assert.match(request.system_message, /Use apenas a delegacao deste turno/);
  assert.match(request.system_message, new RegExp(delegation.replaceAll(".", "\\.")));
});

test("normal image generation payload remains identical when experience is omitted", () => {
  const input = {
    messageText: "gere um banner",
    attachments: [],
    intent: "image_generate",
    imageOptions: { quality: "high", size: "1024x1024", output_format: "png" },
  };
  assert.deepEqual(
    buildHermesSessionChatRequest(input),
    buildHermesSessionChatRequest({ ...input, experience: "normal" }),
  );
  assert.match(buildHermesSessionChatRequest(input).message, /Use obrigatoriamente a ferramenta image_generate/);
});

test("Picture payload is system-only delegated and explicitly forbids image_generate", () => {
  const delegation = "picture.header.payload.signature";
  const request = buildHermesSessionChatRequest({
    messageText: "crie uma peça para graduação",
    attachments: [{ kind: "image", name: "logo.png", mime_type: "image/png", inline_data_url: "data:image/png;base64,AAAA" }],
    intent: "image_generate",
    imageOptions: { quality: "high", size: "1024x1024", output_format: "png" },
    experience: "picture",
    pictureWorkspaceId: "workspace-1",
    pictureWorkspaceSummary: { status: "drafting", files: [{ relative_path: "references/logo.png" }] },
    pictureDelegation: delegation,
  });
  assert.match(request.system_message, /Modo Picture-Hermes/);
  assert.match(request.system_message, /Nunca use image_generate/);
  assert.match(request.system_message, /workspace-1/);
  assert.match(request.system_message, new RegExp(delegation.replaceAll(".", "\\.")));
  assert.doesNotMatch(JSON.stringify(request.message), /image_generate/);
  assert.doesNotMatch(JSON.stringify(request.message), new RegExp(delegation.replaceAll(".", "\\.")));
  assert.doesNotMatch(JSON.stringify(request.message), /data:image\/png/);
});

test("Picture payload prescribes the minimal deterministic happy path with literal tool arguments", () => {
  const request = buildHermesSessionChatRequest({
    messageText: "gere sem FAL",
    attachments: [],
    experience: "picture",
    pictureWorkspaceId: "workspace-deterministic",
    pictureWorkspaceSummary: { id: "workspace-deterministic", status: "drafting", files: [] },
    pictureDelegation: "picture.header.payload.signature",
  });

  assert.match(request.system_message, /workspace_id deve ser exatamente a string workspace-deterministic/);
  assert.match(request.system_message, /picture_get_workspace -> picture_start_job -> picture_get_job/);
  assert.match(request.system_message, /compose como primeira e única operação/);
  assert.match(request.system_message, /background, midground, foreground, overlay ou frame/);
});

test("buildHermesSessionChatRequest prepends native memory routing without disabling Hermes memory", () => {

  const request = buildHermesSessionChatRequest({

    messageText: "monte uma campanha conectando curso, persona e CRM",

    attachments: [],

  });



  assert.equal(request.message.startsWith(NEXUS_MEMORY_ROUTING_CONTRACT), true);

  assert.match(request.message, /Memoria Hermes nativa permanece ativa/);

  assert.match(request.message, /Contrato Nexus Humanizer/);

  assert.match(request.message, /Aplique sempre os principios da skill humanizer/);

  assert.match(request.message, /nunca substituem a memoria persistente do Hermes/);

  assert.match(request.message, /MCP RAG ENS/);

  assert.match(request.message, /MCP Graph/);

  assert.match(request.message, /curso, persona e CRM/);

});

test("buildHermesSessionChatRequest enforces conversational planning for Marketing Ops", () => {
  const request = buildHermesSessionChatRequest({
    messageText: "crie uma campanha de volta as aulas e um email de boas-vindas",
    attachments: [],
    nexusContext: { tenantId: "ens", userId: "user-1", userRole: "member" },
  });

  assert.match(request.system_message, /Contrato Nexus Marketing Ops/);
  assert.match(request.system_message, /marketing_ops_prepare_plan_v1/);
  assert.match(request.system_message, /marketing_ops_execute_plan_v1/);
  assert.match(request.system_message, /Nada e persistido antes da confirmacao/);
  assert.match(request.system_message, /course_slug e opcional/);
  assert.match(request.system_message, /marketing_ops_prepare_plan_v1.*campo actions como uma lista/is);
  assert.match(request.system_message, /campaign\.create_draft.*somente os campos type, ref e name/is);
  assert.match(request.system_message, /campaign\.update.*somente depois de a campanha existir/is);
  assert.match(request.system_message, /resposta atual,? no contexto do plano pendente/i);
  assert.match(request.system_message, /pergunta, ressalva, negacao ou alteracao/i);
  assert.match(request.system_message, /nao exponha codigos brutos/);
  assert.match(request.system_message, /plano revisado como pronto/);
  assert.match(request.system_message, /nao ofereca nem inicie gravacoes em Graph/);
  assert.match(request.system_message, /marketing_ops_list_campaign_items_v1/);
  assert.match(request.system_message, /from e to obrigatorios.*ISO 8601 completos com offset/i);
  assert.match(request.system_message, /marketing_ops_get_campaign_timeline_v1/);
  assert.match(request.system_message, /marketing_ops_get_content_v1/);
  assert.match(request.system_message, /marketing_ops_get_object_capabilities_v1/);
  assert.match(request.system_message, /ens_rag_search/);
  assert.match(request.system_message, /nexus_graph_search_validated_work/);
  assert.match(request.system_message, /conteudo retornado.*nao confiavel/i);
  assert.match(request.system_message, /completed, failed e pending/);
  assert.match(request.system_message, /indisponivel.*nao foi concluida/i);
  assert.match(request.system_message, /deep_links/);
  assert.doesNotMatch(request.message, /Contrato Nexus Marketing Ops/);
});

test("buildHermesSessionChatRequest includes validated work role rules for member sessions", () => {

  const request = buildHermesSessionChatRequest({

    messageText: "tem copy validada para gestao financeira?",

    attachments: [],

    nexusContext: {
      tenantId: "ens",
      userId: "user-1",
      userRole: "member",
      userName: "Raphael",
    },

  });

  assert.match(request.message, /nexus_user_role: member/);
  assert.match(request.message, /nexus_graph_search_validated_work/);
  assert.match(request.message, /nexus_graph_save_validated_work/);
  assert.match(request.message, /nunca use nexus_graph_deprecate_validated_work/);
  assert.match(request.message, /member nao pode editar, deprecar ou excluir/);

});

test("humanizer response contract is enabled for every chat turn", () => {

  const request = buildHermesSessionChatRequest({

    messageText: "responda como voce costuma falar comigo",

    attachments: [],

  });

  assert.equal(isNexusHumanizerResponseContractEnabled(), true);

  assert.match(request.message, /Contrato Nexus Humanizer/);

  assert.match(request.message, /remova tom generico de IA/);

  assert.match(request.message, /Nao mencione este contrato/);

  assert.equal(request.message.includes(NEXUS_HUMANIZER_RESPONSE_CONTRACT), true);

});

test("memory routing contract can be disabled without disabling humanizer", () => {

  const previous = process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED;

  process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED = "false";

  try {

    assert.equal(isNexusMemoryRoutingContractEnabled(), false);

    const request = buildHermesSessionChatRequest({

      messageText: "teste simples",

      attachments: [],

    });

    assert.match(request.message, /Contrato Nexus Humanizer/);

    assert.doesNotMatch(request.message, /Contrato Nexus de memoria nativa/);

    assert.match(request.message, /teste simples/);

  } finally {

    if (previous === undefined) delete process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED;

    else process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED = previous;

  }

});

test("all Nexus response contracts can be disabled by environment flags for rollback", () => {

  const previousMemory = process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED;

  const previousHumanizer = process.env.NEXUS_HUMANIZER_RESPONSE_CONTRACT_ENABLED;

  const previousMarketingOps = process.env.NEXUS_MARKETING_OPS_OPERATOR_CONTRACT_ENABLED;

  process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED = "false";

  process.env.NEXUS_HUMANIZER_RESPONSE_CONTRACT_ENABLED = "false";

  process.env.NEXUS_MARKETING_OPS_OPERATOR_CONTRACT_ENABLED = "false";

  try {

    assert.equal(isNexusMemoryRoutingContractEnabled(), false);

    assert.equal(isNexusHumanizerResponseContractEnabled(), false);

    assert.equal(isNexusMarketingOpsOperatorContractEnabled(), false);

    const request = buildHermesSessionChatRequest({

      messageText: "teste simples",

      attachments: [],

    });

    assert.deepEqual(request, {

      message: "teste simples",

    });

  } finally {

    if (previousMemory === undefined) delete process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED;

    else process.env.NEXUS_MEMORY_ROUTING_CONTRACT_ENABLED = previousMemory;

    if (previousHumanizer === undefined) delete process.env.NEXUS_HUMANIZER_RESPONSE_CONTRACT_ENABLED;

    else process.env.NEXUS_HUMANIZER_RESPONSE_CONTRACT_ENABLED = previousHumanizer;

    if (previousMarketingOps === undefined) delete process.env.NEXUS_MARKETING_OPS_OPERATOR_CONTRACT_ENABLED;

    else process.env.NEXUS_MARKETING_OPS_OPERATOR_CONTRACT_ENABLED = previousMarketingOps;

  }

});



test("buildHermesSessionChatRequest sends current images as Hermes session multimodal input", () => {

  const request = buildHermesSessionChatRequest({

    messageText: "analise esta imagem",

    attachments: [{

      kind: "image",

      name: "layout.png",

      mime_type: "image/png",

      storage_path: "user-1/session-1/layout.png",

      signed_url: "https://project.supabase.co/storage/v1/object/sign/chat-attachments/user-1/session-1/layout.png?token=abc",

      inline_data_url: "data:image/png;base64,AAAA",

    }],

  });



  assert.equal(Array.isArray(request.message), true);

  assert.equal(request.message.length, 2);

  assert.equal(request.message[0].type, "input_text");

  assert.match(request.message[0].text, /analise esta imagem/);

  assert.match(request.message[0].text, /Memoria Hermes nativa permanece ativa/);

  assert.match(request.message[0].text, /Contrato Nexus Humanizer/);

  assert.equal(request.message[1].type, "input_image");

  assert.equal(request.message[1].image_url, "data:image/png;base64,AAAA");

  assert.equal("detail" in request.message[1], false);

});
test("buildHermesSessionChatRequest turns image mode into image_generate instructions", () => {

  const request = buildHermesSessionChatRequest({

    messageText: "crie um banner para campanha da ENS",

    attachments: [{

      kind: "image",

      name: "referencia.png",

      mime_type: "image/png",

      storage_path: "user-1/session-1/referencia.png",

      signed_url: "https://project.supabase.co/storage/v1/object/sign/chat-attachments/user-1/session-1/referencia.png?token=abc",

      inline_data_url: "data:image/png;base64,AAAA",

      hermes_image_path: "/opt/data/nexus-image-inputs/session-1/referencia.png",

    }],

    intent: "image_generate",

    imageOptions: {

      quality: "high",

      size: "2560x1440",

      output_format: "webp",

    },

  });

  assert.equal(Array.isArray(request.message), true);

  assert.match(request.message[0].text, /Use obrigatoriamente a ferramenta image_generate/);

  assert.match(request.message[0].text, /Contrato Nexus Humanizer/);

  assert.match(request.message[0].text, /Antes de chamar image_generate, consulte/);

  assert.match(request.message[0].text, /quality: high/);

  assert.match(request.message[0].text, /size: 2560x1440/);

  assert.match(request.message[0].text, /output_format: webp/);

  assert.match(request.message[0].text, /aspect_ratio: landscape/);

  assert.match(request.message[0].text, /input_images/);

  assert.match(request.message[0].text, /mode: auto\|reference\|edit/);

  assert.match(request.message[0].text, /referencia\.png/);

  assert.match(request.message[0].text, /\/opt\/data\/nexus-image-inputs\/session-1\/referencia\.png/);

  assert.match(request.message[0].text, /input_images: \["\/opt\/data\/nexus-image-inputs\/session-1\/referencia\.png"\]/);

  assert.doesNotMatch(request.message[0].text, /token=abc/);

  assert.doesNotMatch(request.message[0].text, /data:image\/png;base64,AAAA/);

  assert.match(request.message[0].text, /Nao tente baixar/);

  assert.match(request.message[0].text, /editar|trocar|remover|preservar o resto/);

  assert.equal(request.message.some((part) => part.type === "input_image"), false);

});



test("shouldUseResponsesApi routes images and non-extracted files to multimodal responses", () => {

  assert.equal(shouldUseResponsesApi([]), false);

  assert.equal(shouldUseResponsesApi([{ kind: "image", mime_type: "image/png" }]), true);

  assert.equal(shouldUseResponsesApi([{ kind: "file", mime_type: "application/pdf", extracted_text: "" }]), true);

  assert.equal(shouldUseResponsesApi([{ kind: "file", mime_type: "text/plain", extracted_text: "ok" }]), false);

});



test("buildHermesResponsesRequest sends conversation only on first Responses turn", () => {

  const request = buildHermesResponsesRequest({

    modelName: "hermes-agent",

    userId: "user-1",

    sessionId: "session-1",

    messageText: "primeira pergunta",

    attachments: [],

    conversationId: "nexus:user-1:session-1",

  });



  assert.equal(request.conversation, "nexus:user-1:session-1");

  assert.equal("previous_response_id" in request, false);

});



test("buildHermesResponsesRequest does not combine conversation with previous_response_id", () => {

  const request = buildHermesResponsesRequest({

    modelName: "hermes-agent",

    userId: "user-1",

    sessionId: "session-1",

    messageText: "continua",

    attachments: [],

    conversationId: "nexus:user-1:session-1",

    previousResponseId: "resp_123",

  });



  assert.equal(request.previous_response_id, "resp_123");

  assert.equal("conversation" in request, false);

});

