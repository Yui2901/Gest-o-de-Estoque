import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Boxes,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePlus,
  ClipboardList,
  Home,
  LayoutGrid,
  Loader2,
  Menu,
  PackagePlus,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Save,
  ShoppingCart,
  Trash2,
  TrendingDown,
  UserCircle,
  Check,
  X,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey,
  getListActivityQueryKey,
  getListOrdersQueryKey,
  getListProductsQueryKey,
  useCreateOrder,
  useCreateProduct,
  useCreateStockMovement,
  useDeleteProduct,
  useGetDashboardSummary,
  useListActivity,
  useListOrders,
  useListProducts,
  useUpdateProduct,
} from '@workspace/api-client-react';
import type { Order, Product, ProductAccent, ProductInput, ProductStatus, StockMovementInput } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR');

type StatusFilter = 'all' | 'normal' | 'low' | 'out';
type SellerProfile = {
  name: string;
  role: string;
  email: string;
  phone: string;
  store: string;
};

const PROFILE_STORAGE_KEY = 'seller-profile';

const defaultProfile: SellerProfile = {
  name: 'Marina Costa',
  role: 'Operação',
  email: 'marina@exemplo.com',
  phone: '(11) 98765-4321',
  store: 'Nuvem Cosméticos',
};

function normalizeProfile(value: unknown): SellerProfile {
  const saved = value && typeof value === 'object' ? value as Partial<SellerProfile> : {};
  return {
    name: typeof saved.name === 'string' && saved.name.trim() ? saved.name.trim() : defaultProfile.name,
    role: typeof saved.role === 'string' && saved.role.trim() ? saved.role.trim() : defaultProfile.role,
    email: typeof saved.email === 'string' ? saved.email : defaultProfile.email,
    phone: typeof saved.phone === 'string' ? saved.phone : defaultProfile.phone,
    store: typeof saved.store === 'string' ? saved.store : defaultProfile.store,
  };
}

function readProfile(): SellerProfile {
  try {
    const saved = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    return saved ? normalizeProfile(JSON.parse(saved)) : defaultProfile;
  } catch {
    return defaultProfile;
  }
}

function saveProfile(profile: SellerProfile) {
  const normalized = normalizeProfile(profile);
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event('profilechange'));
  return normalized;
}

function profileInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'MC';
}

type ProductForm = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  accent: ProductAccent;
  unitPrice: string;
  stock: string;
  minStock: string;
};

const emptyForm: ProductForm = {
  sku: '',
  name: '',
  category: '',
  brand: '',
  accent: 'pink',
  unitPrice: '',
  stock: '0',
  minStock: '3',
};

function formatDate(value?: string) {
  if (!value) return 'agora';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(value))
    .replace('.', '');
}

function statusLabel(status: ProductStatus) {
  return status === 'normal' ? 'Em dia' : status === 'low' ? 'Estoque baixo' : 'Esgotado';
}

function StatusPill({ status }: { status: ProductStatus }) {
  const styles = status === 'normal'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
    : status === 'low'
      ? 'bg-amber-50 text-amber-700 ring-amber-600/15'
      : 'bg-rose-50 text-rose-700 ring-rose-600/15';
  return <span data-testid={`status-product-${status}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${styles}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${status === 'normal' ? 'bg-emerald-500' : status === 'low' ? 'bg-amber-500' : 'bg-rose-500'}`} />
    {statusLabel(status)}
  </span>;
}

function BrandMark() {
  return <Link href="/" data-testid="link-brand" className="flex items-center gap-3">
    <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ee7e9f] text-[#3d1e2c] shadow-[0_7px_18px_rgba(238,126,159,.22)]">
      <span className="absolute h-5 w-5 rounded-full border-[3px] border-current" />
      <span className="absolute h-2 w-2 rounded-full bg-current" />
    </span>
    <span>
      <span className="block font-extrabold tracking-[-0.04em] text-[17px]">nuvem</span>
      <span className="block font-mono text-[9px] uppercase tracking-[.2em] opacity-55">estoque</span>
    </span>
  </Link>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState<SellerProfile>(readProfile);
  useEffect(() => {
    const syncProfile = () => setProfile(readProfile());
    window.addEventListener('profilechange', syncProfile);
    window.addEventListener('storage', syncProfile);
    return () => {
      window.removeEventListener('profilechange', syncProfile);
      window.removeEventListener('storage', syncProfile);
    };
  }, []);
  const links = [
    { href: '/', label: 'Visão geral', icon: Home },
    { href: '/produtos', label: 'Produtos', icon: LayoutGrid },
    { href: '/pedidos', label: 'Pedidos', icon: ShoppingCart },
    { href: '/perfil', label: 'Meu perfil', icon: UserCircle },
  ];
  return <div className="min-h-[100dvh] bg-background text-foreground">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-7 pb-8 pt-7"><BrandMark /></div>
      <div className="px-4">
        <p className="mb-3 px-3 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-sidebar-foreground/45">Workspace</p>
        <nav className="space-y-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? location === '/' : location.startsWith(href);
            return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`}
              className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}>
              <Icon size={17} strokeWidth={active ? 2.4 : 1.8} /><span>{label}</span>{active && <ChevronRight className="ml-auto opacity-60" size={14} />}
            </Link>;
          })}
        </nav>
      </div>
      <div className="mt-auto p-5">
        <div className="rounded-2xl border border-sidebar-border bg-sidebar-accent/60 p-4">
          <div className="mb-3 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/50">Rotina de hoje</span><CircleCheck size={15} className="text-sidebar-primary" /></div>
          <p className="text-[12px] leading-relaxed text-sidebar-foreground/75">Confira os itens em alerta antes da próxima reposição.</p>
          <Link href="/produtos?status=low" data-testid="link-low-stock" className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-sidebar-primary">Ver alertas <ChevronRight size={13} /></Link>
        </div>
        <div className="mt-5 flex items-center gap-3 border-t border-sidebar-border pt-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#df693f] text-xs font-extrabold text-white">{profileInitials(profile.name)}</div>
          <div><p className="max-w-[145px] truncate text-xs font-bold">{profile.name}</p><p className="text-[10px] text-sidebar-foreground/45">{profile.role}</p></div>
        </div>
      </div>
    </aside>
    <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-border/80 bg-background/95 px-5 backdrop-blur md:hidden">
      <BrandMark />
      <button type="button" data-testid="button-mobile-menu" onClick={() => setMobileOpen(true)} className="rounded-xl p-2 hover:bg-muted"><Menu size={20} /></button>
    </header>
    {mobileOpen && <div className="fixed inset-0 z-50 bg-foreground/20 md:hidden" onClick={() => setMobileOpen(false)}>
      <aside className="h-full w-[280px] bg-sidebar p-6 text-sidebar-foreground shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-9 flex items-center justify-between"><BrandMark /><button type="button" data-testid="button-close-mobile-menu" onClick={() => setMobileOpen(false)} className="rounded-lg p-1.5 hover:bg-sidebar-accent"><X size={18} /></button></div>
        <nav className="space-y-1">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} data-testid={`link-mobile-${label.toLowerCase().replace(' ', '-')}`} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-sidebar-accent"><Icon size={17} />{label}</Link>)}</nav>
      </aside>
    </div>}
    <main className="min-h-[100dvh] md:pl-[248px]">{children}</main>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
    <div><p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-primary">{eyebrow}</p><h1 className="text-[30px] font-extrabold leading-[1.1] tracking-[-.05em] text-foreground sm:text-[36px]">{title}</h1>{description && <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>}</div>
    {action}
  </header>;
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-xl bg-muted ${className}`} />;
}

function QueryError({ onRetry }: { onRetry?: () => void }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-destructive/35 bg-rose-50/40 p-8 text-center"><AlertCircle className="mb-3 text-destructive" size={25} /><p className="text-sm font-bold">Não conseguimos carregar seus dados</p><p className="mt-1 text-xs text-muted-foreground">Tente novamente em alguns instantes.</p>{onRetry && <button type="button" onClick={onRetry} data-testid="button-retry" className="mt-4 rounded-xl bg-foreground px-4 py-2 text-xs font-bold text-background">Tentar novamente</button>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'pink' }: { label: string; value: string; detail: string; icon: typeof Boxes; tone?: 'pink' | 'orange' | 'neutral' | 'alert' }) {
  const accent = tone === 'pink' ? 'bg-[#fbe8ef] text-[#c44b72]' : tone === 'orange' ? 'bg-[#fff0e4] text-[#d86a3b]' : tone === 'alert' ? 'bg-[#fff4d9] text-[#b57916]' : 'bg-muted text-muted-foreground';
  return <article className="group rounded-2xl border border-border/80 bg-card p-5 shadow-[0_4px_22px_rgba(91,44,61,.035)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(91,44,61,.08)]">
    <div className="flex items-start justify-between"><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}><Icon size={17} strokeWidth={2.2} /></div><span className="font-mono text-[10px] text-muted-foreground">agora</span></div>
    <p className="mt-5 text-[12px] font-semibold text-muted-foreground">{label}</p><p data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="mt-1 text-[28px] font-extrabold tracking-[-.05em] tabular">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
  </article>;
}

function Dashboard() {
  const summaryQuery = useGetDashboardSummary();
  const activityQuery = useListActivity();
  const productsQuery = useListProducts({}, { query: { staleTime: 30_000, queryKey: getListProductsQueryKey({}) } });
  const profile = readProfile();
  const summary = summaryQuery.data;
  const products = productsQuery.data ?? [];
  const attention = useMemo(() => products.filter((product) => product.status !== 'normal').slice(0, 4), [products]);
  const activity = (activityQuery.data ?? []).slice(0, 6);
  const hasError = summaryQuery.isError || activityQuery.isError;
  return <div className="page-enter px-5 py-8 sm:px-8 lg:px-12 lg:py-11">
    <PageHeader eyebrow="terça, 24 de junho" title={`Bom dia, ${profile.name.split(' ')[0] || 'por aqui'}.`} description="Seu inventário em um só lugar. Aqui está o que pede atenção hoje." action={<Link href="/produtos/novo" data-testid="link-new-product-dashboard" className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-extrabold text-primary-foreground shadow-[0_8px_18px_rgba(194,74,112,.18)] transition hover:-translate-y-0.5 hover:brightness-105"><Plus size={16} /> Novo produto</Link>} />
    {hasError ? <QueryError onRetry={() => { void summaryQuery.refetch(); void activityQuery.refetch(); }} /> : <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryQuery.isLoading ? Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-[164px]" />) : summary ? <>
          <MetricCard label="Produtos ativos" value={number.format(summary.totalProducts)} detail="itens no catálogo" icon={Boxes} tone="pink" />
          <MetricCard label="Unidades em estoque" value={number.format(summary.totalUnits)} detail="somando todos os itens" icon={PackagePlus} tone="orange" />
          <MetricCard label="Estoque baixo" value={number.format(summary.lowStock)} detail="abaixo do mínimo definido" icon={TrendingDown} tone="alert" />
          <MetricCard label="Valor do inventário" value={currency.format(summary.inventoryValue)} detail={`${summary.outOfStock} itens esgotados`} icon={ReceiptText} tone="neutral" />
        </> : null}
      </section>
      <section className="mt-7 grid gap-6 xl:grid-cols-[1.22fr_.78fr]">
        <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_4px_22px_rgba(91,44,61,.035)]">
          <div className="mb-6 flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Movimentações</p><h2 className="mt-1 text-lg font-extrabold tracking-[-.03em]">O que acabou de se mover</h2></div><Link href="/produtos" data-testid="link-all-products-activity" className="text-xs font-bold text-primary hover:underline">Ver catálogo</Link></div>
          {activityQuery.isLoading ? <div className="space-y-4">{Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-12" />)}</div> : activity.length === 0 ? <EmptyState icon={ClipboardList} title="Nenhuma movimentação ainda" description="Entradas e saídas registradas aparecem aqui." /> : <div className="divide-y divide-border/70">{activity.map((item) => <div key={item.id} data-testid={`activity-row-${item.id}`} className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.type === 'in' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>{item.type === 'in' ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</div><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold">{item.productName}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.note || (item.type === 'in' ? 'Entrada de estoque' : 'Saída de estoque')}</p></div><div className="text-right"><p className={`font-mono text-xs font-medium ${item.type === 'in' ? 'text-emerald-600' : 'text-orange-600'}`}>{item.type === 'in' ? '+' : '-'}{item.quantity} un.</p><p className="mt-1 text-[10px] text-muted-foreground">{formatDate(item.createdAt)}</p></div></div>)}</div>}
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-[0_12px_32px_rgba(61,30,44,.12)]">
          <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full border-[26px] border-[#df693f]/25" /><div className="absolute -bottom-20 -left-16 h-44 w-44 rounded-full border-[22px] border-[#ee7e9f]/20" />
          <div className="relative"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/50">Para olhar agora</p><h2 className="mt-2 max-w-[220px] text-xl font-extrabold leading-tight tracking-[-.04em]">Não deixe a prateleira decidir por você.</h2><p className="mt-3 max-w-[250px] text-xs leading-relaxed text-sidebar-foreground/65">Estes itens estão abaixo do mínimo. Uma reposição pequena hoje evita uma venda perdida amanhã.</p>
          <div className="mt-6 space-y-2">{productsQuery.isLoading ? <SkeletonBlock className="h-14 bg-sidebar-accent" /> : attention.length === 0 ? <p className="rounded-xl bg-sidebar-accent/70 p-3 text-xs text-sidebar-foreground/70">Tudo certo por aqui. Nenhum alerta ativo.</p> : attention.map((product) => <Link href={`/produtos/${product.id}`} key={product.id} data-testid={`link-attention-${product.id}`} className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 p-3 transition hover:bg-sidebar-accent"><div className={`h-2 w-2 rounded-full ${product.accent === 'pink' ? 'bg-[#ee7e9f]' : 'bg-[#df693f]'}`} /><span className="min-w-0 flex-1 truncate text-xs font-bold">{product.name}</span><span className="font-mono text-[10px] text-[#f6b3c7]">{product.stock} un.</span></Link>)}</div>
          <Link href="/produtos?status=low" data-testid="link-see-alerts" className="relative mt-5 inline-flex items-center gap-1 text-xs font-bold text-[#f6b3c7]">Revisar alertas <ChevronRight size={14} /></Link></div>
        </div>
      </section>
    </>}
  </div>;
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof ClipboardList; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Icon size={20} /></div><p className="text-sm font-bold">{title}</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>{action}</div>;
}

function ProductTable({ products, onDelete }: { products: Product[]; onDelete: (product: Product) => void }) {
  if (!products.length) return <EmptyState icon={Boxes} title="Nenhum produto encontrado" description="Tente mudar os filtros ou adicione o primeiro produto ao seu catálogo." action={<Link href="/produtos/novo" data-testid="link-empty-new-product" className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground">Adicionar produto</Link>} />;
  return <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_4px_22px_rgba(91,44,61,.035)]"><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left"><thead><tr className="border-b border-border bg-muted/35"><th className="px-5 py-3.5 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Produto</th><th className="px-4 py-3.5 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Categoria</th><th className="px-4 py-3.5 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Preço</th><th className="px-4 py-3.5 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Estoque</th><th className="px-4 py-3.5 font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Status</th><th className="px-5 py-3.5 text-right font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Ações</th></tr></thead><tbody className="divide-y divide-border/70">{products.map((product) => <tr key={product.id} data-testid={`row-product-${product.id}`} className="group transition hover:bg-muted/25"><td className="px-5 py-4"><Link href={`/produtos/${product.id}`} data-testid={`link-product-${product.id}`} className="flex items-center gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${product.accent === 'pink' ? 'bg-[#fbe8ef] text-[#c44b72]' : 'bg-[#fff0e4] text-[#d86a3b]'}`}>{product.brand.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><span className="block max-w-[220px] truncate text-[13px] font-extrabold">{product.name}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{product.brand} · {product.sku}</span></span></Link></td><td className="px-4 py-4 text-xs text-muted-foreground">{product.category}</td><td className="px-4 py-4 font-mono text-xs tabular">{currency.format(product.unitPrice)}</td><td className="px-4 py-4"><span className="font-mono text-sm font-medium tabular">{product.stock}</span><span className="ml-1.5 text-[10px] text-muted-foreground">/ mín. {product.minStock}</span></td><td className="px-4 py-4"><StatusPill status={product.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1 opacity-60 transition group-hover:opacity-100"><Link href={`/produtos/${product.id}`} data-testid={`button-edit-product-${product.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil size={15} /></Link><button type="button" data-testid={`button-delete-product-${product.id}`} onClick={() => onDelete(product)} className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-destructive"><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-border/70 px-5 py-3 text-[11px] text-muted-foreground"><span>{products.length} {products.length === 1 ? 'produto encontrado' : 'produtos encontrados'}</span><span className="font-mono">última atualização agora</span></div></div>;
}

function Catalog() {
  const initialStatus = new URLSearchParams(window.location.search).get('status') as StatusFilter | null;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>(initialStatus === 'low' ? 'low' : 'all');
  const [category, setCategory] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const queryParams = { search: search || undefined, status: status === 'all' ? undefined : status, category: category === 'all' ? undefined : category };
  const query = useListProducts(queryParams, { query: { placeholderData: (previous) => previous, queryKey: getListProductsQueryKey(queryParams) } });
  const deleteMutation = useDeleteProduct();
  const client = useQueryClient();
  const products = query.data ?? [];
  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category))).sort(), [products]);
  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id }, { onSuccess: () => { setDeleteTarget(null); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); } });
  };
  return <div className="page-enter px-5 py-8 sm:px-8 lg:px-12 lg:py-11">
     <PageHeader eyebrow="catálogo" title="Produtos" description="Uma leitura rápida do que está disponível, quase acabando ou já saiu de cena." action={<div className="flex flex-wrap gap-2"><Link href="/pedidos" data-testid="link-new-order-catalog" className="inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs font-extrabold text-foreground transition hover:bg-muted"><ShoppingCart size={16} /> Montar pedido</Link><Link href="/produtos/novo" data-testid="link-new-product-catalog" className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-extrabold text-primary-foreground shadow-[0_8px_18px_rgba(194,74,112,.18)] transition hover:-translate-y-0.5 hover:brightness-105"><Plus size={16} /> Novo produto</Link></div>} />
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3 sm:flex-row sm:items-center"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-products" placeholder="Buscar por nome, SKU ou marca..." className="h-11 w-full rounded-xl bg-muted/50 pl-10 pr-3 text-sm outline-none ring-primary/20 placeholder:text-muted-foreground/75 focus:ring-2" /></label><div className="flex gap-2"><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} data-testid="select-product-status" className="h-11 rounded-xl border-0 bg-muted/50 px-3 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"><option value="all">Todos os status</option><option value="normal">Em dia</option><option value="low">Estoque baixo</option><option value="out">Esgotado</option></select><select value={category} onChange={(event) => setCategory(event.target.value)} data-testid="select-product-category" className="hidden h-11 rounded-xl border-0 bg-muted/50 px-3 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20 sm:block"><option value="all">Todas as categorias</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div>
    {query.isError ? <QueryError onRetry={() => void query.refetch()} /> : query.isLoading ? <div className="space-y-2 rounded-2xl border border-border/80 bg-card p-4">{Array.from({ length: 7 }).map((_, index) => <SkeletonBlock key={index} className="h-14" />)}</div> : <ProductTable products={products} onDelete={setDeleteTarget} />}
    {deleteTarget && <ConfirmDialog title="Excluir este produto?" description={`“${deleteTarget.name}” e seu histórico deixarão de aparecer no catálogo.`} confirmLabel={deleteMutation.isPending ? 'Excluindo...' : 'Excluir produto'} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} danger />}
  </div>;
}

function OrderSummary({ order, featured = false }: { order: Order; featured?: boolean }) {
  return <section className={`rounded-2xl border p-6 ${featured ? 'border-emerald-200 bg-emerald-50/60' : 'border-border/80 bg-card shadow-[0_4px_22px_rgba(91,44,61,.035)]'}`}>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div>
        <p className={`font-mono text-[10px] uppercase tracking-[.18em] ${featured ? 'text-emerald-700' : 'text-muted-foreground'}`}>{featured ? 'pedido finalizado' : 'pedido de compras'}</p>
        <h2 className="mt-1 text-lg font-extrabold tracking-[-.03em]">Pedido #{order.id}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
      </div>
      <span className="inline-flex w-fit items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Estoque atualizado</span>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-background/80 p-4"><p className="text-[11px] font-bold text-muted-foreground">Itens pedidos</p><p className="mt-1 text-2xl font-extrabold tabular">{number.format(order.totalItems)} <span className="text-xs font-medium text-muted-foreground">un.</span></p></div>
      <div className="rounded-xl bg-background/80 p-4"><p className="text-[11px] font-bold text-muted-foreground">Valor do pedido</p><p className="mt-1 text-2xl font-extrabold tabular">{currency.format(order.totalValue)}</p></div>
    </div>
    <div className="mt-5 border-t border-border/60 pt-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Itens comprados</p>
      <div className="space-y-2.5">{order.items.map((item) => <div key={item.id} className="flex items-center gap-3 text-sm"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-[10px] font-bold">{item.quantity}</span><span className="min-w-0 flex-1"><span className="block truncate font-bold">{item.productName}</span><span className="block font-mono text-[10px] text-muted-foreground">{item.sku} · {currency.format(item.unitPrice)} cada</span></span><span className="font-mono text-xs font-bold tabular">{currency.format(item.totalValue)}</span></div>)}</div>
    </div>
  </section>;
}

function OrdersPage() {
  const productsQuery = useListProducts({}, { query: { staleTime: 15_000, queryKey: getListProductsQueryKey({}) } });
  const ordersQuery = useListOrders();
  const createOrder = useCreateOrder();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const products = productsQuery.data ?? [];
  const orders = ordersQuery.data ?? [];
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) => `${product.name} ${product.brand} ${product.sku}`.toLowerCase().includes(query));
  }, [products, search]);
  const selectedItems = useMemo(() => Object.entries(selected)
    .map(([id, quantity]) => {
      const product = products.find((item) => item.id === Number(id));
      return product ? { product, quantity } : null;
    })
    .filter((item): item is { product: Product; quantity: number } => item !== null && item.quantity > 0), [products, selected]);
  const totalItems = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = selectedItems.reduce((sum, item) => sum + item.product.unitPrice * item.quantity, 0);

  const changeQuantity = (productId: number, amount: number) => {
    setSelected((current) => {
      const nextQuantity = (current[productId] ?? 0) + amount;
      if (nextQuantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: nextQuantity };
    });
  };

  const finalizeOrder = () => {
    if (!selectedItems.length || createOrder.isPending) return;
    createOrder.mutate({
      data: { items: selectedItems.map(({ product, quantity }) => ({ productId: product.id, quantity })) },
    }, {
      onSuccess: (order) => {
        setLastOrder(order);
        setSelected({});
        void client.invalidateQueries({ queryKey: getListProductsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getListActivityQueryKey() });
        void client.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      },
    });
  };

  return <div className="page-enter px-5 py-8 sm:px-8 lg:px-12 lg:py-11">
    <PageHeader eyebrow="compras" title="Pedidos" description="Monte uma compra com os produtos do catálogo e atualize o estoque quando finalizar." action={<Link href="/produtos" data-testid="link-orders-catalog" className="inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs font-extrabold text-foreground transition hover:bg-muted"><LayoutGrid size={16} /> Ver catálogo</Link>} />
    <div className="grid gap-5 xl:grid-cols-[1.18fr_.82fr]">
      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_4px_22px_rgba(91,44,61,.035)] sm:p-6">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">catálogo integrado</p><h2 className="mt-1 text-lg font-extrabold tracking-[-.03em]">Escolha os produtos</h2></div><span className="text-xs text-muted-foreground">{products.length} {products.length === 1 ? 'produto disponível' : 'produtos disponíveis'}</span></div>
        <label className="relative mb-5 block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-order-search" placeholder="Buscar produto, marca ou SKU..." className="h-11 w-full rounded-xl bg-muted/50 pl-10 pr-3 text-sm outline-none ring-primary/20 placeholder:text-muted-foreground/75 focus:ring-2" /></label>
        {productsQuery.isError ? <QueryError onRetry={() => void productsQuery.refetch()} /> : productsQuery.isLoading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-20" />)}</div> : filteredProducts.length === 0 ? <EmptyState icon={Boxes} title="Nenhum produto encontrado" description="Cadastre o produto no catálogo ou ajuste a busca." /> : <div className="space-y-2.5">{filteredProducts.map((product) => { const quantity = selected[product.id] ?? 0; return <div key={product.id} data-testid={`order-product-${product.id}`} className={`flex items-center gap-3 rounded-xl border p-3 transition ${quantity > 0 ? 'border-primary/40 bg-primary/5' : 'border-border/70 hover:border-primary/25'}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${product.accent === 'pink' ? 'bg-[#fbe8ef] text-[#c44b72]' : 'bg-[#fff0e4] text-[#d86a3b]'}`}>{product.brand.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-extrabold">{product.name}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{product.brand} · {product.sku} · estoque atual {number.format(product.stock)}</p><p className="mt-1 text-xs font-bold text-foreground">{currency.format(product.unitPrice)} <span className="font-normal text-muted-foreground">por unidade</span></p></div>{quantity > 0 ? <div className="flex items-center gap-2 rounded-lg bg-background p-1 shadow-sm"><button type="button" aria-label={`Remover uma unidade de ${product.name}`} onClick={() => changeQuantity(product.id, -1)} data-testid={`button-order-decrease-${product.id}`} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><span className="text-lg leading-none">−</span></button><span className="w-8 text-center font-mono text-xs font-bold tabular">{quantity}</span><button type="button" aria-label={`Adicionar uma unidade de ${product.name}`} onClick={() => changeQuantity(product.id, 1)} data-testid={`button-order-increase-${product.id}`} className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:brightness-105"><Plus size={14} /></button></div> : <button type="button" onClick={() => changeQuantity(product.id, 1)} data-testid={`button-order-add-${product.id}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-bold text-background transition hover:opacity-90"><Plus size={14} /> Adicionar</button>}</div>; })}</div>}
      </section>
      <section className="h-fit rounded-2xl border border-border/80 bg-card p-5 shadow-[0_4px_22px_rgba(91,44,61,.035)] sm:p-6 xl:sticky xl:top-6">
        <div className="mb-6 flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">conferência</p><h2 className="mt-1 text-lg font-extrabold tracking-[-.03em]">Resumo do pedido</h2></div><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff0e4] text-[#d86a3b]"><ReceiptText size={17} /></div></div>
        {selectedItems.length === 0 ? <div className="rounded-xl border border-dashed border-border p-6 text-center"><ShoppingCart className="mx-auto mb-3 text-muted-foreground" size={24} /><p className="text-sm font-bold">Seu pedido está vazio</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Selecione os produtos e as quantidades que deseja comprar.</p></div> : <><div className="space-y-3">{selectedItems.map(({ product, quantity }) => <div key={product.id} className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{product.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{quantity} un. × {currency.format(product.unitPrice)}</p></div><p className="font-mono text-xs font-bold tabular">{currency.format(product.unitPrice * quantity)}</p></div>)}</div><div className="mt-6 border-t border-border/70 pt-5"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>Total de itens</span><span className="font-mono font-bold text-foreground">{number.format(totalItems)} un.</span></div><div className="mt-2 flex items-center justify-between"><span className="text-sm font-extrabold">Valor do pedido</span><span className="font-mono text-xl font-extrabold tabular">{currency.format(totalValue)}</span></div><button type="button" onClick={finalizeOrder} disabled={createOrder.isPending} data-testid="button-finalize-order" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-xs font-extrabold text-primary-foreground shadow-[0_8px_18px_rgba(194,74,112,.18)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">{createOrder.isPending && <Loader2 size={15} className="animate-spin" />}{createOrder.isPending ? 'Finalizando pedido...' : 'Finalizar pedido e atualizar estoque'}</button><p className="mt-3 text-center text-[10px] leading-relaxed text-muted-foreground">Ao finalizar, as quantidades entram no estoque e ficam registradas no histórico.</p></div></>}{createOrder.isError && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-destructive">Não foi possível finalizar o pedido. Confira os produtos e tente novamente.</p>}</section>
    </div>
    {lastOrder && <div className="mt-6"><OrderSummary order={lastOrder} featured /></div>}
    <section className="mt-7">
      <div className="mb-4 flex items-end justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">histórico</p><h2 className="mt-1 text-lg font-extrabold tracking-[-.03em]">Pedidos finalizados</h2></div><span className="text-xs text-muted-foreground">{orders.length} registrados</span></div>
      {ordersQuery.isError ? <QueryError onRetry={() => void ordersQuery.refetch()} /> : ordersQuery.isLoading ? <div className="grid gap-4 lg:grid-cols-2"><SkeletonBlock className="h-72" /><SkeletonBlock className="h-72" /></div> : orders.length === 0 ? <EmptyState icon={ClipboardList} title="Nenhum pedido finalizado" description="Os pedidos concluídos aparecerão aqui com seus itens e valores." /> : <div className="grid gap-4 lg:grid-cols-2">{orders.map((order) => <OrderSummary key={order.id} order={order} />)}</div>}
    </section>
  </div>;
}

function ConfirmDialog({ title, description, confirmLabel, onCancel, onConfirm, danger = false }: { title: string; description: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void; danger?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-5 backdrop-blur-[2px]"><div role="dialog" className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${danger ? 'bg-rose-50 text-destructive' : 'bg-muted text-foreground'}`}>{danger ? <Trash2 size={18} /> : <CircleAlert size={18} />}</div><h2 className="text-lg font-extrabold tracking-[-.03em]">{title}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p><div className="mt-6 flex justify-end gap-2"><button type="button" data-testid="button-dialog-cancel" onClick={onCancel} className="rounded-xl px-4 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted">Cancelar</button><button type="button" data-testid="button-dialog-confirm" onClick={onConfirm} disabled={false} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white ${danger ? 'bg-destructive hover:brightness-105' : 'bg-primary'}`}>{confirmLabel}</button></div></div></div>;
}

function ProductFormPage({ editId }: { editId?: number }) {
  const isEdit = editId !== undefined;
  const productQuery = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const product = productQuery.data?.find((item) => item.id === editId);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState('');
  const [, setLocation] = useLocation();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const client = useQueryClient();
  if (isEdit && product && !initialized) { setForm({ sku: product.sku, name: product.name, category: product.category, brand: product.brand, accent: product.accent, unitPrice: String(product.unitPrice), stock: String(product.stock), minStock: String(product.minStock) }); setInitialized(true); }
  const setField = (key: keyof ProductForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.sku.trim() || !form.name.trim() || !form.category.trim() || !form.brand.trim() || Number(form.unitPrice) < 0 || Number(form.minStock) < 0) { setError('Preencha os campos obrigatórios e confira os valores.'); return; }
    if (isEdit && editId !== undefined) {
      update.mutate({ id: editId, data: { sku: form.sku.trim(), name: form.name.trim(), category: form.category.trim(), brand: form.brand.trim(), accent: form.accent, unitPrice: Number(form.unitPrice), minStock: Number(form.minStock) } }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setLocation(`/produtos/${editId}`); } });
    } else {
      const payload: ProductInput = { sku: form.sku.trim(), name: form.name.trim(), category: form.category.trim(), brand: form.brand.trim(), accent: form.accent, unitPrice: Number(form.unitPrice), stock: Number(form.stock), minStock: Number(form.minStock) };
      create.mutate({ data: payload }, { onSuccess: (created) => { void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setLocation(`/produtos/${created.id}`); } });
    }
  };
  if (isEdit && productQuery.isLoading) return <div className="px-5 py-8 sm:px-8 lg:px-12"><SkeletonBlock className="h-10 w-64" /><SkeletonBlock className="mt-8 h-[520px] w-full" /></div>;
  if (isEdit && (productQuery.isError || !product)) return <div className="px-5 py-8 sm:px-8 lg:px-12"><QueryError onRetry={() => void productQuery.refetch()} /></div>;
  const pending = create.isPending || update.isPending;
  return <div className="page-enter px-5 py-8 sm:px-8 lg:px-12 lg:py-11"><Link href={isEdit ? `/produtos/${editId}` : '/produtos'} data-testid="link-back-product-form" className="mb-7 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft size={15} /> Voltar para {isEdit ? 'detalhes' : 'produtos'}</Link><PageHeader eyebrow={isEdit ? 'editar produto' : 'novo cadastro'} title={isEdit ? 'Ajustar produto' : 'Adicionar produto'} description={isEdit ? 'Mantenha os dados do catálogo alinhados com a prateleira.' : 'Cadastre um item uma vez. Depois, acompanhe cada unidade que entra e sai.'} /><form onSubmit={submit} className="max-w-4xl"><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><div className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_4px_22px_rgba(91,44,61,.035)]"><div className="mb-6 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbe8ef] text-[#c44b72]"><ClipboardList size={17} /></div><div><h2 className="text-sm font-extrabold">Informações do produto</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Como ele aparece no seu catálogo.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Nome do produto" value={form.name} onChange={(value) => setField('name', value)} placeholder="Ex.: Balm labial Cherry" testId="input-product-name" required /><Field label="SKU" value={form.sku} onChange={(value) => setField('sku', value)} placeholder="Ex.: CHR-BALM-01" testId="input-product-sku" required /><Field label="Marca" value={form.brand} onChange={(value) => setField('brand', value)} placeholder="Ex.: Rare Beauty" testId="input-product-brand" required /><Field label="Categoria" value={form.category} onChange={(value) => setField('category', value)} placeholder="Ex.: Lábios" testId="input-product-category" required /></div></div><div className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_4px_22px_rgba(91,44,61,.035)]"><div className="mb-6 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff0e4] text-[#d86a3b]"><ReceiptText size={17} /></div><div><h2 className="text-sm font-extrabold">Valores e identidade</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Preço, mínimo e família visual.</p></div></div><Field label="Preço unitário" value={form.unitPrice} onChange={(value) => setField('unitPrice', value)} placeholder="0,00" testId="input-product-price" type="number" min="0" step="0.01" required /><div className="mt-4"><label className="mb-2 block text-[11px] font-bold text-muted-foreground">Família visual</label><div className="grid grid-cols-2 gap-2"><button type="button" data-testid="button-accent-pink" onClick={() => setField('accent', 'pink')} className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-xs font-bold transition ${form.accent === 'pink' ? 'border-[#ee7e9f] bg-[#fbe8ef] text-[#a83f61]' : 'border-border hover:border-[#ee7e9f]/50'}`}><span className="h-3 w-3 rounded-full bg-[#ee7e9f]" /> Rosado</button><button type="button" data-testid="button-accent-orange" onClick={() => setField('accent', 'orange')} className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-xs font-bold transition ${form.accent === 'orange' ? 'border-[#df693f] bg-[#fff0e4] text-[#b5522f]' : 'border-border hover:border-[#df693f]/50'}`}><span className="h-3 w-3 rounded-full bg-[#df693f]" /> Laranja</button></div></div></div></div><div className="mt-5 rounded-2xl border border-border/80 bg-card p-6 shadow-[0_4px_22px_rgba(91,44,61,.035)]"><div className="mb-6 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Boxes size={17} /></div><div><h2 className="text-sm font-extrabold">Controle de estoque</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{isEdit ? 'O estoque muda por entradas e saídas, não por edição manual.' : 'Defina o ponto de partida do seu inventário.'}</p></div></div><div className="grid gap-4 sm:grid-cols-2">{!isEdit && <Field label="Estoque inicial" value={form.stock} onChange={(value) => setField('stock', value)} placeholder="0" testId="input-product-stock" type="number" min="0" required />}<Field label="Estoque mínimo" value={form.minStock} onChange={(value) => setField('minStock', value)} placeholder="3" testId="input-product-min-stock" type="number" min="0" required /></div></div>{error && <p className="mt-4 flex items-center gap-2 text-xs font-bold text-destructive"><AlertCircle size={14} /> {error}</p>}{(create.isError || update.isError) && <p className="mt-4 flex items-center gap-2 text-xs font-bold text-destructive"><AlertCircle size={14} /> Não foi possível salvar. Confira os dados e tente novamente.</p>}<div className="mt-6 flex justify-end gap-2"><Link href={isEdit ? `/produtos/${editId}` : '/produtos'} data-testid="link-cancel-product-form" className="rounded-xl px-4 py-3 text-xs font-bold text-muted-foreground hover:bg-muted">Cancelar</Link><button type="submit" disabled={pending} data-testid="button-submit-product" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-xs font-extrabold text-primary-foreground shadow-[0_8px_18px_rgba(194,74,112,.18)] disabled:cursor-not-allowed disabled:opacity-60">{pending && <Loader2 size={15} className="animate-spin" />}{isEdit ? 'Salvar alterações' : 'Cadastrar produto'}</button></div></form></div>;
}

function Field({ label, value, onChange, placeholder, testId, type = 'text', min, step, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; testId: string; type?: string; min?: string; step?: string; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-[11px] font-bold text-muted-foreground">{label}{required && <span className="ml-0.5 text-primary">*</span>}</span><input value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} placeholder={placeholder} type={type} min={min} step={step} required={required} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>;
}

function ProductDetail({ id }: { id: number }) {
  const query = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const product = query.data?.find((item) => item.id === id);
  const [movementType, setMovementType] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [movementError, setMovementError] = useState('');
  const movement = useCreateStockMovement();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const submitMovement = (event: FormEvent) => {
    event.preventDefault();
    setMovementError('');
    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed < 1) { setMovementError('Informe uma quantidade inteira maior que zero.'); return; }
    if (movementType === 'out' && product && parsed > product.stock) { setMovementError('A saída não pode ser maior que o estoque disponível.'); return; }
    const payload: StockMovementInput = { type: movementType, quantity: parsed, note: note.trim() || undefined };
    movement.mutate({ id, data: payload }, { onSuccess: () => { setQuantity('1'); setNote(''); void client.invalidateQueries({ queryKey: getListProductsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void client.invalidateQueries({ queryKey: getListActivityQueryKey() }); } });
  };
  if (query.isLoading) return <div className="px-5 py-8 sm:px-8 lg:px-12"><SkeletonBlock className="h-8 w-44" /><SkeletonBlock className="mt-8 h-[450px]" /></div>;
  if (query.isError || !product) return <div className="px-5 py-8 sm:px-8 lg:px-12"><QueryError onRetry={() => void query.refetch()} /></div>;
  return <div className="page-enter px-5 py-8 sm:px-8 lg:px-12 lg:py-11"><Link href="/produtos" data-testid="link-back-catalog" className="mb-7 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft size={15} /> Voltar para produtos</Link><div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="mb-3 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${product.accent === 'pink' ? 'bg-[#ee7e9f]' : 'bg-[#df693f]'}`} /><span className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">{product.brand} · {product.sku}</span></div><h1 data-testid="text-product-detail-name" className="text-[30px] font-extrabold leading-[1.1] tracking-[-.05em] sm:text-[40px]">{product.name}</h1><p className="mt-2 text-sm text-muted-foreground">{product.category} · atualizado {formatDate(product.updatedAt)}</p></div><div className="flex items-center gap-2"><Link href={`/produtos/${id}/editar`} data-testid="link-edit-product" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs font-bold hover:bg-muted"><Pencil size={15} /> Editar</Link><Link href="/produtos/novo" data-testid="link-detail-new-product" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground"><Plus size={15} /> Novo produto</Link></div></div><div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div className="space-y-5"><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-border/80 bg-card p-5"><p className="text-[11px] font-bold text-muted-foreground">Disponível agora</p><p data-testid="text-product-stock" className="mt-2 text-3xl font-extrabold tracking-[-.05em] tabular">{product.stock}<span className="ml-1 text-sm font-medium text-muted-foreground">un.</span></p><div className="mt-3"><StatusPill status={product.status} /></div></div><div className="rounded-2xl border border-border/80 bg-card p-5"><p className="text-[11px] font-bold text-muted-foreground">Preço unitário</p><p className="mt-2 text-2xl font-extrabold tracking-[-.05em] tabular">{currency.format(product.unitPrice)}</p><p className="mt-3 text-[10px] text-muted-foreground">valor de venda</p></div><div className="rounded-2xl border border-border/80 bg-card p-5"><p className="text-[11px] font-bold text-muted-foreground">Estoque mínimo</p><p className="mt-2 text-3xl font-extrabold tracking-[-.05em] tabular">{product.minStock}<span className="ml-1 text-sm font-medium text-muted-foreground">un.</span></p><p className="mt-3 text-[10px] text-muted-foreground">ponto de reposição</p></div></div><div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6"><div className={`absolute right-0 top-0 h-32 w-32 rounded-bl-[80px] ${product.accent === 'pink' ? 'bg-[#fbe8ef]' : 'bg-[#fff0e4]'}`} /><div className="relative"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Leitura rápida</p><h2 className="mt-2 text-lg font-extrabold tracking-[-.03em]">{product.status === 'normal' ? 'Este item está respirando bem.' : product.status === 'low' ? 'Este item está pedindo atenção.' : 'Este item está sem unidades.'}</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{product.status === 'normal' ? `Há ${product.stock - product.minStock} unidades acima do mínimo. Você pode seguir a rotina sem pressa.` : product.status === 'low' ? `Restam ${product.stock} unidades e o mínimo definido é ${product.minStock}. Vale incluir na próxima compra.` : 'Registre uma entrada assim que a reposição chegar para manter o catálogo confiável.'}</p><div className="mt-6 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${product.accent === 'pink' ? 'bg-[#ee7e9f]' : 'bg-[#df693f]'}`} style={{ width: `${Math.min(100, product.minStock ? (product.stock / product.minStock) * 100 : 100)}%` }} /></div><div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground"><span>0 un.</span><span>mínimo {product.minStock}</span></div></div></div></div><div className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_4px_22px_rgba(91,44,61,.035)]"><div className="mb-6"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Movimentar estoque</p><h2 className="mt-1 text-lg font-extrabold tracking-[-.03em]">Registrar entrada ou saída</h2></div><form onSubmit={submitMovement}><div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1"><button type="button" data-testid="button-stock-in" onClick={() => setMovementType('in')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition ${movementType === 'in' ? 'bg-card text-emerald-700 shadow-sm' : 'text-muted-foreground'}`}><ArrowDownToLine size={15} /> Entrada</button><button type="button" data-testid="button-stock-out" onClick={() => setMovementType('out')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition ${movementType === 'out' ? 'bg-card text-orange-700 shadow-sm' : 'text-muted-foreground'}`}><ArrowUpFromLine size={15} /> Saída</button></div><label className="mt-5 block"><span className="mb-2 block text-[11px] font-bold text-muted-foreground">Quantidade</span><input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} data-testid="input-stock-quantity" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label><label className="mt-4 block"><span className="mb-2 block text-[11px] font-bold text-muted-foreground">Nota <span className="font-normal opacity-70">(opcional)</span></span><textarea value={note} onChange={(event) => setNote(event.target.value)} data-testid="input-stock-note" placeholder={movementType === 'in' ? 'Ex.: compra com fornecedor' : 'Ex.: venda pelo site'} rows={3} className="w-full resize-none rounded-xl border border-input bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>{movementError && <p className="mt-3 text-xs font-bold text-destructive">{movementError}</p>}{movement.isError && <p className="mt-3 text-xs font-bold text-destructive">Não foi possível registrar esta movimentação.</p>}<button type="submit" disabled={movement.isPending} data-testid="button-submit-stock-movement" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3 text-xs font-extrabold text-background transition hover:opacity-90 disabled:opacity-60">{movement.isPending && <Loader2 size={15} className="animate-spin" />} Registrar {movementType === 'in' ? 'entrada' : 'saída'}</button></form><div className="mt-5 flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground"><CircleAlert className="mt-0.5 shrink-0" size={14} /> O saldo é atualizado automaticamente e aparece no painel.</div></div></div></div>;
}

function ProfilePage() {
  const [profile, setProfile] = useState<SellerProfile>(readProfile);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const setField = (key: keyof SellerProfile, value: string) => {
    setSaved(false);
    setError('');
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!profile.name.trim()) {
      setError('Informe seu nome para salvar o perfil.');
      return;
    }
    try {
      setProfile(saveProfile({
        ...profile,
        name: profile.name.trim(),
        role: profile.role.trim() || 'Operação',
        email: profile.email.trim(),
        phone: profile.phone.trim(),
        store: profile.store.trim(),
      }));
      setSaved(true);
    } catch {
      setError('Não foi possível salvar agora. Tente novamente.');
    }
  };

  return <div className="page-enter px-5 py-8 sm:px-8 lg:px-12 lg:py-11">
    <PageHeader eyebrow="conta" title="Meu perfil" description="Mantenha seus dados atualizados para deixar a operação com a sua cara." />
    <form onSubmit={submit} className="max-w-4xl">
      <div className="grid gap-5 lg:grid-cols-[.72fr_1.28fr]">
        <section className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-[0_12px_32px_rgba(61,30,44,.12)]">
          <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full border-[24px] border-[#df693f]/25" />
          <div className="absolute -bottom-20 -left-14 h-44 w-44 rounded-full border-[22px] border-[#ee7e9f]/20" />
          <div className="relative">
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/50">Sua presença</p>
            <div className="mt-7 flex h-24 w-24 items-center justify-center rounded-[28px] border-4 border-[#f6b3c7]/30 bg-[#ee7e9f] text-3xl font-extrabold text-[#3d1e2c] shadow-[0_10px_25px_rgba(238,126,159,.2)]">{profileInitials(profile.name)}</div>
            <h2 className="mt-6 text-xl font-extrabold tracking-[-.04em]">{profile.name || 'Seu nome'}</h2>
            <p className="mt-1 text-sm text-sidebar-foreground/60">{profile.role || 'Operação'}</p>
            <div className="mt-8 border-t border-sidebar-border pt-5">
              <p className="text-[11px] leading-relaxed text-sidebar-foreground/65">Esses dados aparecem no acesso rápido do sistema e ajudam a identificar quem está cuidando do estoque.</p>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_4px_22px_rgba(91,44,61,.035)] sm:p-7">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fbe8ef] text-[#c44b72]"><UserCircle size={19} /></div>
            <div><h2 className="text-sm font-extrabold">Informações do perfil</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Dados usados para personalizar seu espaço.</p></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo" value={profile.name} onChange={(value) => setField('name', value)} placeholder="Ex.: Marina Costa" testId="input-profile-name" required />
            <Field label="Função" value={profile.role} onChange={(value) => setField('role', value)} placeholder="Ex.: Operação" testId="input-profile-role" />
            <Field label="E-mail" value={profile.email} onChange={(value) => setField('email', value)} placeholder="voce@exemplo.com" testId="input-profile-email" type="email" />
            <Field label="Telefone" value={profile.phone} onChange={(value) => setField('phone', value)} placeholder="(00) 00000-0000" testId="input-profile-phone" type="tel" />
          </div>
          <div className="mt-4"><Field label="Nome da loja" value={profile.store} onChange={(value) => setField('store', value)} placeholder="Ex.: Nuvem Cosméticos" testId="input-profile-store" /></div>
          {error && <p className="mt-4 text-xs font-bold text-destructive">{error}</p>}
          <div className="mt-7 flex flex-col-reverse items-stretch justify-end gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center">
            {saved && <span className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-700 sm:mr-auto"><Check size={15} /> Perfil atualizado</span>}
            <button type="submit" data-testid="button-save-profile" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-xs font-extrabold text-primary-foreground shadow-[0_8px_18px_rgba(194,74,112,.18)] transition hover:-translate-y-0.5 hover:brightness-105"><Save size={15} /> Salvar alterações</button>
          </div>
        </section>
      </div>
    </form>
  </div>;
}

function AppRouter() {
  return <Shell><Switch><Route path="/" component={Dashboard} /><Route path="/pedidos" component={OrdersPage} /><Route path="/perfil" component={ProfilePage} /><Route path="/produtos/novo" component={() => <ProductFormPage />} /><Route path="/produtos/:id/editar" component={() => { const params = useParams<{ id: string }>(); return <ProductFormPage editId={Number(params.id)} />; }} /><Route path="/produtos/:id" component={() => { const params = useParams<{ id: string }>(); return <ProductDetail id={Number(params.id)} />; }} /><Route path="/produtos" component={Catalog} /><Route component={NotFound} /></Switch></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><ErrorBoundary><AppRouter /></ErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
