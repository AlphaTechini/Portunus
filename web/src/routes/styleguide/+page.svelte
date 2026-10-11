<script lang="ts">
	import { page } from '$app/state';
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Download from '@lucide/svelte/icons/download';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Search from '@lucide/svelte/icons/search';
	import Filter from '@lucide/svelte/icons/filter';
	import Copy from '@lucide/svelte/icons/copy';
	import MoreHorizontal from '@lucide/svelte/icons/ellipsis';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Wallet from '@lucide/svelte/icons/wallet';
	import Clock from '@lucide/svelte/icons/clock';
	import Inbox from '@lucide/svelte/icons/inbox';
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import {
		AppShell,
		PageHeader,
		Logo,
		Button,
		IconButton,
		Badge,
		StatusPill,
		TempoTag,
		Tooltip,
		Field,
		Input,
		Select,
		Textarea,
		Checkbox,
		Switch,
		SegmentedControl,
		Card,
		Stat,
		Table,
		Money,
		Hash,
		ContainerNumber,
		Countdown,
		Meter,
		Timeline,
		Modal,
		Drawer,
		Tabs,
		Skeleton,
		EmptyState,
		PasskeyButton,
		NetworkBadge,
		LiveIndicator,
		toast,
		CONTAINER_STATES,
		TEMPO_FEATURES,
		formatMoney,
		formatDate,
		formatDays,
		type TempoFeatureKey,
		type TimelineEntry,
		type TableColumn,
		type Org,
		type Role
	} from '#lib/ui';

	// ---------------------------------------------------------------------------
	// Shell demo state
	// ---------------------------------------------------------------------------
	const orgs: Org[] = [
		{ id: 'ngl', name: 'Northgate Lines', role: 'line', location: 'Apapa, Lagos' },
		{ id: 'ado', name: 'Adebayo Foods', role: 'importer', location: 'Lagos' },
		{ id: 'hcl', name: 'Harbourline Clearing', role: 'importer', location: 'Mombasa' }
	];
	let role = $state<Role>('line');
	let org = $state<Org>(orgs[0]);

	function setRole(r: Role) {
		role = r;
		org = orgs.find((o) => o.role === r) ?? org;
	}

	// ---------------------------------------------------------------------------
	// Demo data
	// ---------------------------------------------------------------------------
	const now = Date.now();
	const H = 3_600_000;
	const D = 24 * H;

	let mode = $state<'held' | 'free'>('held');
	let view = $state<'all' | 'free' | 'detention'>('all');
	let tab = $state<'trail' | 'charges' | 'key'>('trail');
	let bl = $state('NGLLOS2409171');
	let container = $state('NGLU4829108');
	let deposit = $state('2000.00');
	let freeDays = $state('7');
	let size = $state('40HC');
	let note = $state('');
	let agree = $state(true);
	let notify = $state(true);
	let modalOpen = $state(false);
	let drawerOpen = $state(false);
	let passkey = $state<'idle' | 'waiting' | 'success' | 'error'>('idle');

	function runPasskey() {
		passkey = 'waiting';
		setTimeout(() => (passkey = 'success'), 1600);
		setTimeout(() => (passkey = 'idle'), 3800);
	}

	const trail: TimelineEntry[] = [
		{
			id: 't1',
			kind: 'request',
			title: 'Release request created',
			actor: 'Northgate Lines',
			detail: '3 containers on one bill of lading',
			timestamp: now - 9 * D
		},
		{
			id: 't2',
			kind: 'deposit',
			title: 'Deposit held by protocol',
			amount: 2000,
			actor: 'Adebayo Foods',
			detail: 'Paid to the container virtual address',
			memo: 'NGLU4829108 · BL NGLLOS2409171',
			txHash: '0x8f3a5c0e91b27d4460fa1c3398e2d5b7a61f0c94e2b8d7135a6c9f02e44bc41e',
			finalityMs: 482,
			timestamp: now - 9 * D + 6 * H
		},
		{
			id: 't3',
			kind: 'release',
			title: 'Release order issued',
			actor: 'Northgate Lines',
			timestamp: now - 9 * D + 6 * H + 40_000
		},
		{
			id: 't4',
			kind: 'pull',
			title: 'Detention, day 1',
			amount: 150,
			memo: 'NGLU4829108 · DET D1',
			txHash: '0x1b77e0c2a9d4f6083a51c27e9be41d0f6c3a8825d9e0b4f17a2c6e3d90a1f5b2',
			finalityMs: 511,
			actor: 'Access key, line charges address',
			timestamp: now - 1 * D
		},
		{
			id: 't5',
			kind: 'refused',
			title: 'Second pull the same day',
			amount: 150,
			status: 'failed',
			detail: 'Recurring limit enforced by the protocol, not by our app',
			timestamp: now - 1 * D + 2 * 60_000
		},
		{
			id: 't6',
			kind: 'return',
			title: 'Empty returned',
			detail: 'EIR LOS-0417-2291, Ikeja depot',
			actor: 'Northgate Lines',
			timestamp: now - 3 * H
		},
		{
			id: 't7',
			kind: 'settlement',
			title: 'Settlement submitted',
			status: 'pending',
			memo: 'NGLU4829108 · BL NGLLOS2409171 · EIR LOS-0417-2291',
			timestamp: now - 10_000
		}
	];

	interface Row {
		id: string;
		container: string;
		type: string;
		state: (typeof CONTAINER_STATES)[number];
		deposit: number;
		accrued: number;
		freeTimeEnd: number;
	}

	const rows: Row[] = [
		{
			id: 'r1',
			container: 'NGLU4829108',
			type: '40HC',
			state: 'in_free_time',
			deposit: 2000,
			accrued: 0,
			freeTimeEnd: now + 4 * D + 6 * H
		},
		{
			id: 'r2',
			container: 'NGLU3055711',
			type: '20GP',
			state: 'in_detention',
			deposit: 1000,
			accrued: 450,
			freeTimeEnd: now - 3 * D
		},
		{
			id: 'r3',
			container: 'NGLU7712049',
			type: '40HC',
			state: 'authorized',
			deposit: 2000,
			accrued: 0,
			freeTimeEnd: now + 9 * H
		},
		{
			id: 'r4',
			container: 'NGLU1183420',
			type: '40GP',
			state: 'settled',
			deposit: 2000,
			accrued: 300,
			freeTimeEnd: now - 6 * D
		}
	];

	const columns: TableColumn[] = [
		{ key: 'container', label: 'Container', width: '30%' },
		{ key: 'state', label: 'Status' },
		{ key: 'freeTimeEnd', label: 'Free time', hideBelow: 'md' },
		{ key: 'accrued', label: 'Detention', numeric: true, hideBelow: 'sm' },
		{ key: 'deposit', label: 'Deposit', numeric: true }
	];

	const features = Object.keys(TEMPO_FEATURES) as TempoFeatureKey[];

	const colorTokens = [
		['--color-bg', 'Canvas'],
		['--color-surface', 'Surface'],
		['--color-surface-sunken', 'Sunken'],
		['--color-border', 'Border'],
		['--color-text', 'Text'],
		['--color-text-secondary', 'Text secondary'],
		['--color-text-tertiary', 'Text tertiary'],
		['--color-primary', 'Primary (ink)'],
		['--color-accent', 'Accent (petrol)'],
		['--color-accent-subtle', 'Accent subtle'],
		['--color-band-bg', 'Band']
	];

	const tones = ['neutral', 'protocol', 'info', 'success', 'warning', 'caution', 'danger'] as const;

	const typeScale = [
		['--text-6xl', 'Display 72', 'display'],
		['--text-4xl', 'Section 40', 'display'],
		['--text-2xl', 'Page title 24', 'sans'],
		['--text-lg', 'Lead 18', 'sans'],
		['--text-base', 'Body 14', 'sans'],
		['--text-sm', 'UI 13, the app default', 'sans'],
		['--text-xs', 'Meta 12', 'sans'],
		['--text-2xs', 'Overline 11', 'sans']
	];

	const toc = [
		['brand', 'Brand'],
		['color', 'Color'],
		['type', 'Typography'],
		['space', 'Space, radius, elevation'],
		['buttons', 'Buttons'],
		['forms', 'Forms'],
		['status', 'Status'],
		['tempo', 'Tempo tags'],
		['data', 'Data display'],
		['time', 'Countdown and meter'],
		['trail', 'Memo trail'],
		['table', 'Table'],
		['overlays', 'Overlays and feedback'],
		['passkey', 'Passkey'],
		['empty', 'Empty, loading, error']
	];
</script>

<svelte:head>
	<title>Design system · Portunus</title>
</svelte:head>

<AppShell
	{role}
	onRoleChange={setRole}
	{org}
	{orgs}
	onOrgChange={(o) => {
		org = o;
		role = o.role;
	}}
	path={page.url.pathname}
	live="live"
	user={{ name: 'Ada Okafor', email: 'ada@northgate.example' }}
>
	<PageHeader
		title="Design system"
		subtitle="Every token, component and state in the Portunus UI. Build pages from these parts; do not restyle them locally."
		breadcrumbs={[{ label: 'Portunus', href: '/' }, { label: 'Design system' }]}
	>
		{#snippet actions()}
			<Button variant="secondary" href="/" icon={ArrowRight}>Landing page</Button>
		{/snippet}
		{#snippet meta()}
			<NetworkBadge />
			<LiveIndicator />
			<Badge tone="neutral" mono>docs/design/DESIGN.md</Badge>
		{/snippet}
	</PageHeader>

	<nav class="toc" aria-label="On this page">
		{#each toc as [id, label] (id)}<a href="#{id}">{label}</a>{/each}
	</nav>

	<!-- ================================================================= -->
	<section id="brand" class="sg">
		<h2 class="sg-h">Brand</h2>
		<p class="sg-p">
			Portunus is the Roman god of keys, doors and harbours. The mark is a harbour gate on a quay
			with a keyhole cut through it. Use the key motif sparingly: the mark, the TempoTag glyph, and
			nowhere decorative.
		</p>
		<div class="grid-3">
			<Card padding="lg"><div class="brand-tile"><Logo size={32} /></div></Card>
			<Card padding="lg"><div class="brand-tile"><Logo variant="mark" size={48} /></div></Card>
			<div class="brand-band"><Logo size={28} tone="inverse" /></div>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="color" class="sg">
		<h2 class="sg-h">Color</h2>
		<p class="sg-p">
			Ink for primary actions, one petrol accent that means "enforced by the protocol", and seven
			tones used only through StatusPill, Badge and Timeline. Toggle the theme in the top bar to
			check dark.
		</p>
		<div class="swatches">
			{#each colorTokens as [token, name] (token)}
				<div class="swatch">
					<span class="chip" style:background="var({token})"></span>
					<span class="sw-name">{name}</span>
					<code>{token}</code>
				</div>
			{/each}
		</div>
		<div class="tones">
			{#each tones as t (t)}
				<div class="tone-col">
					<span
						class="tone-chip"
						style:background="var(--tone-{t}-bg)"
						style:border-color="var(--tone-{t}-border)"
						style:color="var(--tone-{t}-fg)"
					>
						<span class="tone-dot" style:background="var(--tone-{t}-solid)"></span>{t}
					</span>
					<code>--tone-{t}-*</code>
				</div>
			{/each}
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="type" class="sg">
		<h2 class="sg-h">Typography</h2>
		<p class="sg-p">
			Inter for the interface, Newsreader for editorial display on the landing page only, Geist Mono
			for container numbers, hashes and memos. All amounts use tabular numerals.
		</p>
		<Card padding="none">
			<div class="type-list">
				{#each typeScale as [token, label, fam] (token)}
					<div class="type-row">
						<code>{token}</code>
						<span class="type-sample" class:serif={fam === 'display'} style:font-size="var({token})"
							>{label}</span
						>
					</div>
				{/each}
				<div class="type-row">
					<code>--font-mono</code>
					<span class="mono">NGLU 482910-8 · 0x8f3a5c…c41e · TIP-1022</span>
				</div>
				<div class="type-row">
					<code>.tabular</code>
					<span class="tabular type-num">$1,111.11<br />$9,000.00</span>
				</div>
			</div>
		</Card>
	</section>

	<!-- ================================================================= -->
	<section id="space" class="sg">
		<h2 class="sg-h">Space, radius, elevation</h2>
		<div class="grid-3">
			<Card title="Spacing" description="4px grid. --space-1 is 4px, --space-6 is 24px.">
				<div class="space-bars">
					{#each ['1', '2', '3', '4', '6', '8', '12', '16'] as s (s)}
						<div class="space-row">
							<code>--space-{s}</code><span class="bar" style:width="var(--space-{s})"></span>
						</div>
					{/each}
				</div>
			</Card>
			<Card title="Radius" description="Buttons and inputs 8, cards 12, dialogs 16.">
				<div class="radii">
					{#each ['xs', 'sm', 'md', 'lg', 'xl', 'full'] as r (r)}
						<div class="radius" style:border-radius="var(--radius-{r})"><code>{r}</code></div>
					{/each}
				</div>
			</Card>
			<Card title="Elevation" description="A hairline does most of the work. Shadows stay soft.">
				<div class="radii">
					{#each ['xs', 'sm', 'md', 'lg', 'overlay'] as e (e)}
						<div class="elev" style:box-shadow="var(--shadow-{e})"><code>{e}</code></div>
					{/each}
				</div>
			</Card>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="buttons" class="sg">
		<h2 class="sg-h">Buttons</h2>
		<p class="sg-p">
			One primary (ink) per view. Accent is reserved for the protocol action itself: pay, authorize,
			settle. Danger is outlined, never a red slab.
		</p>
		<Card>
			<div class="stack">
				<div class="row">
					<Button variant="primary" icon={Plus}>New release request</Button>
					<Button variant="accent" icon={ShieldCheck}>Pay 3 deposits</Button>
					<Button variant="secondary" icon={Download}>Export</Button>
					<Button variant="ghost">Cancel</Button>
					<Button variant="danger" icon={Trash2}>Remove container</Button>
				</div>
				<div class="row">
					<Button variant="primary" size="sm">Small</Button>
					<Button variant="primary">Medium</Button>
					<Button variant="primary" size="lg" iconEnd={ArrowRight}>Large</Button>
					<Button variant="accent" loading loadingLabel="Settling">Settle</Button>
					<Button variant="secondary" loading>Saving</Button>
					<Button variant="primary" disabled>Disabled</Button>
				</div>
				<div class="row">
					<IconButton icon={Search} label="Search containers" />
					<IconButton icon={Filter} label="Filter" variant="secondary" />
					<IconButton icon={Copy} label="Copy" size="sm" />
					<IconButton icon={MoreHorizontal} label="More actions" variant="secondary" size="lg" />
				</div>
			</div>
		</Card>
	</section>

	<!-- ================================================================= -->
	<section id="forms" class="sg">
		<h2 class="sg-h">Forms</h2>
		<div class="grid-2">
			<Card
				title="Release request"
				description="Field supplies label, hint and error to the control inside it."
			>
				<div class="stack">
					<Field label="Bill of lading" hint="As printed on the carrier's B/L." required>
						<Input bind:value={bl} mono placeholder="NGLLOS2409171" />
					</Field>
					<Field
						label="Container number"
						error={container.length > 0 && container.length < 11
							? 'Container numbers have 4 letters and 7 digits.'
							: undefined}
					>
						<Input bind:value={container} mono placeholder="MSCU1234566" />
					</Field>
					<div class="grid-2 tight">
						<Field label="Deposit">
							<Input bind:value={deposit} prefix="$" suffix="USD" numeric />
						</Field>
						<Field label="Free days">
							<Input bind:value={freeDays} suffix="days" numeric />
						</Field>
					</div>
					<Field label="Size and type">
						<Select
							bind:value={size}
							options={[
								{ value: '20GP', label: '20ft general purpose' },
								{ value: '40GP', label: '40ft general purpose' },
								{ value: '40HC', label: '40ft high cube' }
							]}
						/>
					</Field>
					<Field label="Deposits account" hint="Set up by Portunus. Not editable." disabled>
						<Input value="0x7c41a9e3…d2" mono disabled />
					</Field>
					<Field label="Note to importer">
						<Textarea bind:value={note} maxlength={240} showCount placeholder="Optional" rows={3} />
					</Field>
					<Checkbox
						bind:checked={agree}
						label="I have checked the container numbers"
						description="Wrong numbers mean wrong deposit addresses."
					/>
					<Switch
						bind:checked={notify}
						label="Remind the importer before detention starts"
						description="One day before free time ends."
					/>
				</div>
			</Card>

			<Card title="Deposit mode" description="SegmentedControl. Arrow keys move between options.">
				<div class="stack">
					<SegmentedControl
						label="Deposit mode for this importer"
						variant="cards"
						bind:value={mode}
						options={[
							{
								value: 'held',
								label: 'Held deposit',
								icon: ShieldCheck,
								description:
									'The deposit moves into the protocol guard. For new or unknown importers.'
							},
							{
								value: 'free',
								label: 'Deposit-free',
								icon: KeyRound,
								description:
									'Nothing moves until a charge is owed. For importers with a clean record.'
							}
						]}
					/>
					{#if mode === 'held'}
						<TempoTag
							feature="receive_policy"
							variant="callout"
							detail="Deposits land in the guard, not in your balance. Only the settlement contract can release them."
						/>
					{:else}
						<TempoTag
							feature="access_key"
							variant="callout"
							label="Access key: up to $150.00 per day, payable only to Northgate Lines"
							detail="Expires {formatDate(
								now + 21 * D
							)}: end of free time plus the maximum detention days."
						/>
					{/if}
					<div class="row">
						<SegmentedControl
							label="Filter containers"
							bind:value={view}
							options={[
								{ value: 'all', label: 'All' },
								{ value: 'free', label: 'In free time' },
								{ value: 'detention', label: 'In detention' }
							]}
						/>
						<SegmentedControl
							label="Small"
							size="sm"
							value="7d"
							options={[
								{ value: '7d', label: '7 days' },
								{ value: '30d', label: '30 days' },
								{ value: '90d', label: '90 days' }
							]}
						/>
					</div>
				</div>
			</Card>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="status" class="sg">
		<h2 class="sg-h">Status</h2>
		<p class="sg-p">
			One pill per container state. Color, icon and label always travel together. Use <code
				>long</code
			> for page headers.
		</p>
		<Card padding="none">
			<div class="status-table">
				{#each CONTAINER_STATES as s (s)}
					<div class="status-row">
						<code>{s}</code>
						<StatusPill state={s} size="sm" />
						<StatusPill state={s} />
						<StatusPill state={s} long size="lg" />
					</div>
				{/each}
			</div>
		</Card>
		<div class="row" style:margin-top="var(--space-4)">
			{#each tones as t (t)}<Badge tone={t} dot>{t}</Badge>{/each}
			<Badge tone="success" dot pulse>Live</Badge>
			<Badge tone="neutral" variant="outline" mono>40HC</Badge>
			<Badge tone="danger" size="sm">2 open</Badge>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="tempo" class="sg">
		<h2 class="sg-h">Tempo tags</h2>
		<p class="sg-p">
			Name the Tempo feature on the page where the viewer sees it working. Hover or focus a tag for
			the explanation and docs link.
		</p>
		<Card>
			<div class="row wrap-gap">
				{#each features as f (f)}<TempoTag feature={f} />{/each}
			</div>
			<div class="row wrap-gap" style:margin-top="var(--space-4)">
				<TempoTag feature="virtual_address" size="sm" />
				<TempoTag feature="batch" size="sm" />
				<TempoTag feature="fee_sponsored" size="sm" flash />
			</div>
		</Card>
		<div class="grid-2" style:margin-top="var(--space-4)">
			<TempoTag
				feature="virtual_address"
				variant="callout"
				detail="One deposit address per container, derived from the line's deposits account."
			>
				<ul class="va-list">
					<li>
						<ContainerNumber value="NGLU4829108" size="sm" /><Hash
							value="0x7c41a9e3b5d0f2c8e1a4b7d9c3e5f8a1b2c409ae"
						/>
					</li>
					<li>
						<ContainerNumber value="NGLU3055711" size="sm" /><Hash
							value="0x7c41a9e3b5d0f2c8e1a4b7d9c3e5f8a1b2c4b3d2"
						/>
					</li>
					<li>
						<ContainerNumber value="NGLU7712049" size="sm" /><Hash
							value="0x7c41a9e3b5d0f2c8e1a4b7d9c3e5f8a1b2c45f17"
						/>
					</li>
				</ul>
			</TempoTag>
			<TempoTag
				feature="held_not_lost"
				variant="callout"
				detail="A stranger sent 50.00 of an unexpected token to a deposit address. It waits in the guard to be returned."
			/>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="data" class="sg">
		<h2 class="sg-h">Data display</h2>
		<div class="grid-4">
			<Stat
				label="Cash currently held"
				value={formatMoney(14000)}
				icon={Wallet}
				hint="7 containers"
				sparkline={[4, 6, 6, 8, 9, 12, 14]}
				sparklineLabel="Rising over 7 days"
			/>
			<Stat
				label="Cash freed this month"
				value={formatMoney(9350)}
				delta={{ value: '+18%', direction: 'up', sentiment: 'positive', context: 'vs last month' }}
			/>
			<Stat
				label="Return to refund"
				value="3.2"
				unit="seconds"
				icon={Clock}
				delta={{ value: '-0.4 s', direction: 'down', sentiment: 'positive' }}
			/>
			<Stat label="Deposit-free exposure" loading value="" />
		</div>
		<div class="grid-2" style:margin-top="var(--space-4)">
			<Card title="Money" description="USD stablecoin, two decimals, tabular numerals.">
				<div class="stack">
					<div class="row baseline"><Money amount={2000} size="display" dimCents /></div>
					<div class="row baseline">
						<Money amount={1250.5} size="xl" />
						<Money amount={1550} size="lg" tone="positive" signed />
						<Money amount={-450} size="lg" tone="negative" />
						<Money amount={2_000_000_000n} unit="pathUSD" />
						<Money amount={1_240_000} compact size="lg" />
					</div>
				</div>
			</Card>
			<Card title="Identifiers" description="Mono, truncated in the middle, always copyable.">
				<div class="stack">
					<ContainerNumber value="MSCU1234566" type="40HC" size="lg" copyable />
					<ContainerNumber value="NGLU3055711" type="20GP" href="#data" />
					<ContainerNumber value="NGLU3055712" validate />
					<Hash
						value="0x8f3a5c0e91b27d4460fa1c3398e2d5b7a61f0c94e2b8d7135a6c9f02e44bc41e"
						kind="tx"
						href="https://explore.tempo.xyz"
					/>
					<Hash value="0x7c41a9e3b5d0f2c8e1a4b7d9c3e5f8a1b2c409ae" label="Deposit address" />
				</div>
			</Card>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="time" class="sg">
		<h2 class="sg-h">Countdown and meter</h2>
		<div class="grid-3">
			<Card title="In free time">
				<Countdown
					target={now + 4 * D + 6 * H + 754_000}
					start={now - 3 * D}
					label="Free time ends in"
					showTarget
				/>
			</Card>
			<Card title="Ending soon">
				<Countdown
					target={now + 5 * H + 12 * 60_000}
					start={now - 7 * D}
					label="Free time ends in"
				/>
			</Card>
			<Card title="Elapsed, counting up">
				<Countdown
					target={now - 3 * D - 2 * H}
					label="Free time ends in"
					elapsedLabel="In detention for"
					countUp
				/>
			</Card>
		</div>
		<div class="row" style:margin-top="var(--space-3)">
			<span class="muted">Inline:</span>
			<Countdown variant="inline" target={now + 2 * D + 3 * H} showSeconds={false} />
			<Countdown variant="inline" target={now + 3 * H + 120_000} />
			<Countdown variant="inline" target={now - 1 * D} elapsedLabel="Ended" />
		</div>
		<div class="grid-2" style:margin-top="var(--space-4)">
			<Card>
				<div class="stack-lg">
					<Meter value={0} max={2000} dailyRate={150} />
					<Meter value={450} max={2000} dailyRate={150} live />
				</div>
			</Card>
			<Card>
				<div class="stack-lg">
					<Meter value={1650} max={2000} dailyRate={150} live />
					<Meter value={2000} max={2000} dailyRate={150} />
				</div>
			</Card>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="trail" class="sg">
		<h2 class="sg-h">Memo trail</h2>
		<div class="grid-2-1">
			<Card
				title="Memo trail"
				description="Every on-chain event with its memo, hash and time to finality."
			>
				{#snippet actions()}<TempoTag feature="memo" size="sm" />{/snippet}
				<Timeline entries={trail} />
			</Card>
			<Card title="Tabs">
				<Tabs
					label="Container sections"
					bind:value={tab}
					items={[
						{ value: 'trail', label: 'Memo trail', count: 7 },
						{ value: 'charges', label: 'Charges' },
						{ value: 'key', label: 'Access key' }
					]}
				>
					{#snippet panel(v)}
						{#if v === 'trail'}
							<Timeline entries={trail.slice(1, 3)} hideMemos />
						{:else if v === 'charges'}
							<p class="muted">Detention 3 days at $150.00: <Money amount={450} /></p>
						{:else}
							<dl class="kv">
								<div>
									<dt>Daily cap</dt>
									<dd><Money amount={150} /></dd>
								</div>
								<div>
									<dt>Recipient</dt>
									<dd>Northgate Lines charges</dd>
								</div>
								<div>
									<dt>Expiry</dt>
									<dd>{formatDate(now + 21 * D)}</dd>
								</div>
								<div>
									<dt>Period</dt>
									<dd>{formatDays(1)}</dd>
								</div>
							</dl>
						{/if}
					{/snippet}
				</Tabs>
				<div style:margin-top="var(--space-6)">
					<Tabs
						label="Pill tabs"
						variant="pill"
						items={[
							{ value: 'open', label: 'Open', count: 2 },
							{ value: 'resolved', label: 'Resolved' }
						]}
					/>
				</div>
			</Card>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="table" class="sg">
		<h2 class="sg-h">Table</h2>
		<Table
			caption="Containers on this bill of lading"
			{columns}
			{rows}
			rowKey={(r) => r.id}
			rowHref={() => '#table'}
			rowLabel={(r) => `Open ${r.container}`}
		>
			{#snippet cell(r, c)}
				{#if c.key === 'container'}
					<ContainerNumber value={r.container} type={r.type} />
				{:else if c.key === 'state'}
					<StatusPill state={r.state} />
				{:else if c.key === 'freeTimeEnd'}
					{#if r.state === 'settled'}
						<span class="muted">Returned</span>
					{:else}
						<Countdown
							variant="inline"
							target={r.freeTimeEnd}
							showSeconds={false}
							countUp
							elapsedLabel="Ended"
						/>
					{/if}
				{:else if c.key === 'accrued'}
					<Money amount={r.accrued} tone={r.accrued ? 'default' : 'muted'} />
				{:else if c.key === 'deposit'}
					<Money amount={r.deposit} />
				{/if}
			{/snippet}
		</Table>
		<div class="grid-2" style:margin-top="var(--space-4)">
			<Table
				caption="Loading"
				{columns}
				rows={[]}
				rowKey={(r: Row) => r.id}
				loading
				loadingRows={3}
			/>
			<Table
				caption="Empty"
				columns={columns.slice(0, 3)}
				rows={[]}
				rowKey={(r: Row) => r.id}
				emptyTitle="No held transfers"
				emptyDescription="Wrong-token or unknown-sender payments appear here, held by the guard until returned."
				emptyIcon={ShieldCheck}
			/>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="overlays" class="sg">
		<h2 class="sg-h">Overlays and feedback</h2>
		<Card>
			<div class="row">
				<Button variant="secondary" onclick={() => (modalOpen = true)}>Open modal</Button>
				<Button variant="secondary" onclick={() => (drawerOpen = true)}>Open drawer</Button>
				<Tooltip text="Tooltips appear on hover and keyboard focus.">
					<Button variant="ghost">Hover or focus me</Button>
				</Tooltip>
				<Button
					variant="secondary"
					onclick={() =>
						toast.protocol('Deposit held by protocol', {
							description: '3 containers on NGLLOS2409171',
							finalityMs: 482,
							txHash: '0x8f3a5c0e91b27d4460fa1c3398e2d5b7a61f0c94e2b8d7135a6c9f02e44bc41e'
						})}>Protocol toast</Button
				>
				<Button
					variant="secondary"
					onclick={() =>
						toast.success('Refunded $1,550.00', { description: '2.8 s after settlement' })}
					>Success toast</Button
				>
				<Button
					variant="secondary"
					onclick={() =>
						toast.error('Pull refused', { description: 'Recurring limit reached for today.' })}
					>Error toast</Button
				>
			</div>
		</Card>
	</section>

	<!-- ================================================================= -->
	<section id="passkey" class="sg">
		<h2 class="sg-h">Passkey</h2>
		<div class="grid-2">
			<Card>
				<div class="stack">
					<PasskeyButton state={passkey} onclick={runPasskey} fullWidth />
					<PasskeyButton
						variant="secondary"
						glyph="fingerprint"
						label="Approve with passkey"
						sublabel="Pays 3 deposits in one transaction"
						fullWidth
					/>
				</div>
			</Card>
			<Card>
				<div class="stack">
					<PasskeyButton state="waiting" fullWidth />
					<PasskeyButton state="error" fullWidth />
				</div>
			</Card>
		</div>
	</section>

	<!-- ================================================================= -->
	<section id="empty" class="sg">
		<h2 class="sg-h">Empty, loading, error</h2>
		<div class="grid-3">
			<Card padding="none">
				<EmptyState
					icon={Inbox}
					title="No release requests yet"
					description="When a line sends you a release request, it appears here with its terms."
				>
					{#snippet actions()}<Button variant="secondary" size="sm">Copy my payer address</Button
						>{/snippet}
				</EmptyState>
			</Card>
			<Card title="Loading">
				<div class="stack">
					<Skeleton width="40%" height="1.25rem" />
					<Skeleton lines={3} />
					<div class="row"><Skeleton circle height="2rem" /><Skeleton width="60%" /></div>
				</div>
			</Card>
			<Card padding="none">
				<EmptyState
					tone="error"
					icon={CloudOff}
					title="Could not reach Tempo"
					description="The step is saved and will retry. Nothing is shown as paid until it is final."
				>
					{#snippet actions()}<Button variant="secondary" size="sm">Retry now</Button>{/snippet}
				</EmptyState>
			</Card>
		</div>
		<div style:margin-top="var(--space-4)">
			<Card padding="none">
				<EmptyState
					compact
					icon={Boxes}
					title="No containers in detention"
					description="Containers past free time show here with live detention against the deposit."
				/>
			</Card>
		</div>
	</section>
</AppShell>

<Modal
	bind:open={modalOpen}
	title="Pay 3 deposits"
	description="One batch transaction. Fees sponsored by Portunus."
>
	<div class="stack">
		<dl class="kv">
			<div>
				<dt>Containers</dt>
				<dd>3 on NGLLOS2409171</dd>
			</div>
			<div>
				<dt>Total</dt>
				<dd><Money amount={5000} /></dd>
			</div>
			<div>
				<dt>Network fee</dt>
				<dd>Sponsored</dd>
			</div>
		</dl>
		<div class="row wrap-gap">
			<TempoTag feature="batch" size="sm" />
			<TempoTag feature="fee_sponsored" size="sm" />
			<TempoTag feature="memo" size="sm" />
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (modalOpen = false)}>Cancel</Button>
		<Button variant="accent" icon={ShieldCheck} onclick={() => (modalOpen = false)}
			>Approve with passkey</Button
		>
	{/snippet}
</Modal>

<Drawer bind:open={drawerOpen} title="NGLU 305571-1" description="In detention, day 3">
	<div class="stack-lg">
		<StatusPill state="in_detention" long size="lg" />
		<Meter value={450} max={1000} dailyRate={150} live />
		<Timeline entries={trail.slice(3, 5)} />
	</div>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (drawerOpen = false)}>Close</Button>
	{/snippet}
</Drawer>

<style>
	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		padding: var(--space-3) 0 var(--space-2);
		margin-bottom: var(--space-4);
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--text-xs);
	}

	.toc a {
		color: var(--color-text-secondary);
	}

	.toc a:hover {
		color: var(--color-text);
	}

	.sg {
		padding: var(--space-10) 0 var(--space-4);
		scroll-margin-top: calc(var(--topbar-height) + var(--space-4));
	}

	.sg-h {
		margin-bottom: var(--space-2);
		font-size: var(--text-xl);
		line-height: var(--leading-xl);
		letter-spacing: var(--tracking-snug);
	}

	.sg-p {
		max-width: 46rem;
		margin-bottom: var(--space-5);
		color: var(--color-text-secondary);
		font-size: var(--text-base);
		line-height: var(--leading-base);
	}

	.sg-p code,
	code {
		font-size: 0.6875rem;
		color: var(--color-text-tertiary);
	}

	.grid-2,
	.grid-3,
	.grid-4,
	.grid-2-1 {
		display: grid;
		gap: var(--space-4);
	}

	.grid-2 {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.grid-2.tight {
		gap: var(--space-3);
	}

	.grid-3 {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.grid-4 {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.grid-2-1 {
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		align-items: start;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.stack-lg {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.row.baseline {
		align-items: baseline;
		gap: var(--space-6);
	}

	.wrap-gap {
		gap: var(--space-2);
	}

	/* brand */
	.brand-tile {
		display: grid;
		place-items: center;
		min-height: 6rem;
	}

	.brand-band {
		display: grid;
		place-items: center;
		min-height: 8.5rem;
		border-radius: var(--radius-lg);
		background: var(--color-band-bg);
		border: 1px solid var(--color-border);
	}

	/* color */
	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: var(--space-3);
	}

	.swatch {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.chip {
		height: 3.5rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}

	.sw-name {
		font-weight: var(--weight-medium);
	}

	.tones {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-5);
	}

	.tone-col {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tone-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid;
		border-radius: var(--radius-md);
		font-weight: var(--weight-medium);
	}

	.tone-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	/* type */
	.type-list {
		display: flex;
		flex-direction: column;
	}

	.type-row {
		display: grid;
		grid-template-columns: 8rem 1fr;
		align-items: baseline;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--color-border-subtle);
		overflow: hidden;
	}

	.type-row:last-child {
		border-bottom: 0;
	}

	.type-sample {
		line-height: 1.15;
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-snug);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.type-sample.serif {
		font-family: var(--font-display);
		font-weight: 460;
		letter-spacing: -0.025em;
	}

	.type-num {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}

	/* space */
	.space-bars {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.space-row {
		display: grid;
		grid-template-columns: 6rem 1fr;
		align-items: center;
	}

	.bar {
		height: 8px;
		border-radius: 2px;
		background: var(--color-accent);
	}

	.radii {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.radius,
	.elev {
		display: grid;
		place-items: center;
		width: 4rem;
		height: 3.25rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.elev {
		border-color: transparent;
		border-radius: var(--radius-md);
	}

	/* status */
	.status-table {
		display: flex;
		flex-direction: column;
	}

	.status-row {
		display: grid;
		justify-items: start;
		grid-template-columns: 10rem 9rem 10rem 1fr;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-2-5) var(--space-5);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.status-row:last-child {
		border-bottom: 0;
	}

	.va-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}

	.va-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.kv {
		display: flex;
		flex-direction: column;
	}

	.kv div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.kv dt {
		color: var(--color-text-secondary);
	}

	.kv dd {
		margin: 0;
		font-weight: var(--weight-medium);
	}

	@media (max-width: 1100px) {
		.grid-4 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.grid-3,
		.grid-2-1 {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.grid-2,
		.grid-4 {
			grid-template-columns: minmax(0, 1fr);
		}

		.status-row {
			grid-template-columns: 1fr auto;
		}

		.status-row :global(.pill:nth-of-type(1)),
		.status-row :global(.pill.lg) {
			display: none;
		}
	}
</style>
