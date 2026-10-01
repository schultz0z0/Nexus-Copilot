(() => {
  const toast = document.querySelector('#feedback');
  let timer;
  function announce(text) { toast.textContent = text; clearTimeout(timer); timer = setTimeout(() => { toast.textContent = ''; }, 4500); }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); announce('Copiado para a área de transferência.'); }
    catch { announce('Cópia indisponível neste navegador. Selecione e copie o texto exibido.'); }
  }
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copy(button.dataset.copy)));
  document.querySelector('#copy-prompt').addEventListener('click', () => copy(document.querySelector('#agent-prompt').textContent.trim()));
  document.querySelector('#print').addEventListener('click', () => window.print());
  let expandedForPrint = [];
  window.addEventListener('beforeprint', () => { expandedForPrint = [...document.querySelectorAll('details:not([open]):not(.no-print)')]; expandedForPrint.forEach(detail => { detail.open = true; }); });
  window.addEventListener('afterprint', () => { expandedForPrint.forEach(detail => { detail.open = false; }); expandedForPrint = []; });
  document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => announce('Exemplo de ' + button.dataset.demo + '. Nenhum dado do produto foi alterado.')));
  const form = document.querySelector('#demo-form');
  const name = document.querySelector('#campaign-name');
  const error = document.querySelector('#campaign-error');
  const result = document.querySelector('#form-result');
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!name.value.trim()) { name.setAttribute('aria-invalid','true'); error.hidden = false; result.textContent = ''; name.focus(); return; }
    name.removeAttribute('aria-invalid'); error.hidden = true;
    const submit = form.querySelector('[type=submit]'); submit.disabled = true; submit.setAttribute('aria-busy','true'); submit.textContent = 'Salvando…';
    setTimeout(() => { submit.disabled = false; submit.removeAttribute('aria-busy'); submit.textContent = 'Testar formulário'; result.textContent = 'Exemplo validado. Nenhuma campanha foi criada.'; }, 700);
  });
  const dialog = document.querySelector('#demo-dialog');
  const opener = document.querySelector('#open-dialog');
  opener.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', () => { opener.focus(); document.querySelector('#dialog-result').textContent = dialog.returnValue === 'confirm' ? 'Confirmação demonstrada. Nenhuma alteração foi executada.' : 'Exemplo de diálogo fechado.'; });
  const tabs = [...document.querySelectorAll('[role=tab]')];
  function selectTab(tab) { tabs.forEach(item => { const active=item===tab; item.setAttribute('aria-selected',String(active)); item.tabIndex=active?0:-1; document.getElementById(item.getAttribute('aria-controls')).hidden=!active; }); }
  tabs.forEach((tab,i) => { tab.addEventListener('click',()=>selectTab(tab)); tab.addEventListener('keydown',event => { let next; if(event.key==='ArrowRight')next=(i+1)%tabs.length; if(event.key==='ArrowLeft')next=(i-1+tabs.length)%tabs.length; if(event.key==='Home')next=0; if(event.key==='End')next=tabs.length-1; if(next!==undefined){event.preventDefault(); selectTab(tabs[next]); tabs[next].focus();} }); });
  document.querySelector('#demo-chat').addEventListener('submit', event => { event.preventDefault(); const input=document.querySelector('#chat-message'); const result=document.querySelector('#chat-result'); result.textContent=input.value.trim()?'Mensagem de exemplo recebida localmente. Este manual não consulta uma IA.':'Digite uma mensagem para experimentar o composer.'; if(!input.value.trim())input.focus(); });
  if ('IntersectionObserver' in window) { const links=[...document.querySelectorAll('.nav a')]; const observer=new IntersectionObserver(entries => { for(const entry of entries){if(entry.isIntersecting){links.forEach(link=>{if(link.hash==='#'+entry.target.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});}} },{rootMargin:'-5% 0px -70% 0px'}); document.querySelectorAll('main>section').forEach(section=>observer.observe(section)); }
})();
