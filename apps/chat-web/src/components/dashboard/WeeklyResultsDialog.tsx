import { useState, type FormEvent } from 'react';
import { CheckCircle2, FileCheck2, ArrowLeft, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CAMPAIGNS, number, validateWeeklyReport, type CampaignId } from '@/lib/dashboard/model';

const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm';

export function WeeklyResultsDialog({ onClose, restoreFocus, initialChannel = 'email', initialCampaign }: { onClose: () => void; restoreFocus: () => void; initialChannel?: 'email' | 'whatsapp'; initialCampaign?: CampaignId }) {
  const [channel, setChannel] = useState<string>(initialChannel);
  const [campaign, setCampaign] = useState<string>(initialCampaign ?? CAMPAIGNS[0].id);
  const [from, setFrom] = useState('2026-09-14');
  const [to, setTo] = useState('2026-09-20');
  const [sent, setSent] = useState('1200');
  const [delivered, setDelivered] = useState('1140');
  const [responses, setResponses] = useState('86');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const campaignName = CAMPAIGNS.find(item => item.id === campaign)?.name;
  const interactionLabel = channel === 'email' ? 'Destinatários com clique' : 'Contatos que responderam';
  const action = channel === 'email' ? 'E-mail de apresentação da oferta' : 'WhatsApp de acompanhamento';
  const report = { from, to, sent: sent.trim() ? Number(sent) : NaN, delivered: delivered.trim() ? Number(delivered) : NaN, responses: responses.trim() ? Number(responses) : NaN };
  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateWeeklyReport(report);
    setError(problem);
    if (!problem) setReview(true);
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-card sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{review ? 'Revisão do informe semanal' : 'Atualização semanal'}</DialogTitle>
        <DialogDescription>Simule como os resultados de e-mail e WhatsApp serão revisados antes do registro via Hermes.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-2 rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-text-secondary"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" /><span>Demonstração: nenhum resultado será salvo ou enviado ao Hermes. Campanhas e ações abaixo são exemplos.</span></div>
      {review ? <div className="space-y-5" aria-live="polite">
        <div className="flex items-center gap-3 text-brand-accent"><FileCheck2 className="h-6 w-6" /><h3 className="font-semibold">Confira antes de registrar</h3></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Campanha</dt><dd className="break-words">{campaignName}</dd>
          <dt className="text-muted-foreground">Ação</dt><dd>{action}</dd>
          <dt className="text-muted-foreground">Período</dt><dd>{from.split('-').reverse().join('/')} a {to.split('-').reverse().join('/')}</dd>
          <dt className="text-muted-foreground">Origem</dt><dd>Relatório manual da plataforma de disparos</dd>
          <dt className="text-muted-foreground">Envios</dt><dd>{number(report.sent)}</dd>
          <dt className="text-muted-foreground">Entregas</dt><dd>{number(report.delivered)}</dd>
          <dt className="text-muted-foreground">{interactionLabel}</dt><dd>{number(report.responses)}</dd>
        </dl>
        <p className="rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-text-secondary">Totais desta janela, sem somar a relatórios anteriores. No fluxo definitivo, o Hermes deverá verificar períodos sobrepostos, apontar correções e aguardar sua confirmação explícita.</p>
        <div className="flex gap-2 text-sm text-status-success"><CheckCircle2 className="h-4 w-4 shrink-0" /><p>Revisão demonstrativa pronta. Nenhum dado foi gravado.</p></div>
        <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" onClick={() => setReview(false)}><ArrowLeft />Editar exemplo</Button><Button onClick={onClose}>Concluir simulação</Button></div>
      </div> : <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="weekly-channel">Canal</Label><select id="weekly-channel" className={selectClass} value={channel} onChange={event => setChannel(event.target.value)}><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option></select></div>
          <div className="space-y-2"><Label htmlFor="weekly-campaign">Campanha do informe</Label><select id="weekly-campaign" className={selectClass} value={campaign} disabled={Boolean(initialCampaign)} onChange={event => setCampaign(event.target.value)}>{CAMPAIGNS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        </div>
        <div className="space-y-2"><Label htmlFor="weekly-action">Ação no calendário</Label><Input id="weekly-action" readOnly value={action} /><p className="text-xs text-muted-foreground">Ação de exemplo vinculada à campanha selecionada.</p></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="weekly-from">Início do período</Label><Input id="weekly-from" type="date" value={from} onChange={event => setFrom(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="weekly-to">Fim do período</Label><Input id="weekly-to" type="date" value={to} onChange={event => setTo(event.target.value)} /></div></div>
        <fieldset className="grid gap-4 sm:grid-cols-3" aria-describedby="weekly-count-help weekly-error"><legend className="mb-3 text-sm font-medium">Totais da janela informada</legend>
          <div className="space-y-2"><Label htmlFor="weekly-sent">Envios</Label><Input id="weekly-sent" type="number" min="0" step="1" value={sent} onChange={event => setSent(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="weekly-delivered">Entregas</Label><Input id="weekly-delivered" type="number" min="0" step="1" value={delivered} onChange={event => setDelivered(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="weekly-responses">{interactionLabel}</Label><Input id="weekly-responses" type="number" min="0" step="1" value={responses} onChange={event => setResponses(event.target.value)} /></div>
        </fieldset>
        <p id="weekly-count-help" className="text-xs leading-relaxed text-muted-foreground">Conte destinatários únicos. Cliques ou respostas repetidas da mesma pessoa não aumentam esta contagem. O exemplo não interpreta esses contatos automaticamente como leads novos.</p>
        <p id="weekly-error" role={error ? 'alert' : undefined} className="text-sm text-status-error">{error}</p>
        <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button type="submit">Revisar exemplo</Button></div>
      </form>}
    </DialogContent>
  </Dialog>;
}
