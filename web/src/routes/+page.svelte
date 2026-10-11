<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Gavel from '@lucide/svelte/icons/gavel';
	import Handshake from '@lucide/svelte/icons/handshake';
	import Umbrella from '@lucide/svelte/icons/umbrella';
	import Coins from '@lucide/svelte/icons/coins';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Zap from '@lucide/svelte/icons/zap';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Ban from '@lucide/svelte/icons/ban';
	import {
		Logo,
		Button,
		TempoTag,
		StatusPill,
		ContainerNumber,
		Countdown,
		Meter,
		Timeline,
		Money,
		NetworkBadge,
		ThemeToggle,
		PasskeyButton,
		TEMPO_PROTOCOL_NOTE,
		type TimelineEntry
	} from '#lib/ui';

	// ---------------------------------------------------------------------------
	// Evidence (details.md section 4). Each figure separate; never add them up.
	// ---------------------------------------------------------------------------
	interface EvidenceRow {
		region: string;
		evidence: string;
		source: string;
		href: string;
	}

	const evidence: EvidenceRow[] = [
		{
			region: 'United States',
			evidence:
				'Nine ocean carriers collected about $15.4B in detention and demurrage charges between April 2020 and March 2025',
			source: 'Official (Federal Maritime Commission)',
			href: 'https://www.fmc.gov/detention-and-demurrage/'
		},
		{
			region: 'United States',
			evidence:
				'Average detention and demurrage of about $2,700 per box two weeks after discharge at Los Angeles/Long Beach (May 2022)',
			source: 'Industry (Container xChange via The Maritime Executive)',
			href: 'https://maritime-executive.com/article/report-american-ports-top-the-list-for-d-d-fees-worldwide'
		},
		{
			region: 'Global, top 20 ports',
			evidence: 'Average $666 per container, rising to $1,219 after two weeks (2021)',
			source: 'Industry (Container xChange via The Loadstar)',
			href: 'https://theloadstar.com/shipper-anger-and-confusion-as-opaque-global-dd-charges-double/'
		},
		{
			region: 'Nigeria',
			evidence:
				'About ₦200,000 deposit per 20ft and ₦400,000 per 40ft container; un-refunded deposits estimated near ₦20bn a year; ₦17bn collected in 2019',
			source: 'News, citing clearing agents (Shipping Position, 2022)',
			href: 'https://shippingposition.com.ng/clearing-agents-knock-shipping-coys-as-un-refunded-container-deposit-near-n20billion/'
		},
		{
			region: 'Kenya / East Africa',
			evidence: 'Deposits of $500 to $2,000 per TEU; about $1.5B a year tied up across East Africa',
			source: 'Opinion article (Nation Africa); ViaTrans gives the same $1.5B (vendor)',
			href: 'https://nation.africa/kenya/blogs-opinion/blogs/avoid-container-deposit-to-cut-cost-of-doing-business-4571774'
		},
		{
			region: 'Kenya',
			evidence:
				'Deposits of $1,000 to $4,000 by container size; refunds delayed after empties are returned; paid in US dollars but refunded in Kenyan shillings; making the cash deposit can take 2 to 4 extra weeks (USAID study quoted)',
			source: 'News (The Star, 2021)',
			href: 'https://www.the-star.co.ke/news/2021-07-16-clearing-agents-accuse-shippers-of-frustration'
		},
		{
			region: 'East Africa (regional body)',
			evidence:
				'Iscos calls cash container deposits "a trade barrier" at Mombasa and Dar es Salaam',
			source: 'News (The EastAfrican, 2020)',
			href: 'https://theeastafrican.co.ke/tea/business-tech/shippers-call-for-scrapping-of-cash-deposits-for-containers-as-security-2370292'
		},
		{
			region: 'Tanzania',
			evidence:
				'A container guarantee product is used by six shipping lines and over 60% of registered clearing agents',
			source: 'Vendor, self-reported (ViaTrans via Trade Finance Global)',
			href: 'https://www.tradefinanceglobal.com/posts/viatrans-unloading-hidden-challenges-shipping-industry/'
		},
		{
			region: 'Philippines',
			evidence:
				'₱10,000 to ₱30,000 deposit per container, held 60 to 90 days; Bureau of Customs draft rule would force refunds within 15 days of the empty-return receipt (Feb 2026)',
			source: 'News (PortCalls)',
			href: 'https://portcalls.com/stop-the-cash-leak-boc-eyes-15-day-clock-on-container-deposits'
		},
		{
			region: 'Pakistan',
			evidence:
				'Karachi Customs Shipping Committee ordered shipping agents to "immediately refund all illegally recovered detention charges, ancillary charges, and container security deposits"; traders reported deposits over Rs 10 million withheld (Feb 2026)',
			source: 'News (Business Recorder)',
			href: 'https://www.brecorder.com/news/amp/40407829'
		},
		{
			region: 'India',
			evidence:
				'Hapag-Lloyd ended its import container security deposit requirement in India in September 2022, showing the practice existed',
			source: 'Carrier notice',
			href: 'https://www.hapag-lloyd.com/fr/company/about-us/newsletter/2022/09/india-import-container-security-deposit.html'
		},
		{
			region: 'Global scale',
			evidence: '849 million TEU handled at world ports in 2021',
			source: 'Industry (Drewry/UNCTAD)',
			href: 'https://porteconomicsmanagement.org/pemp/contents/part1/maritime-shipping-and-international-trade/world-container-throughput/'
		}
	];

	const domain = (href: string) => new URL(href).hostname.replace(/^www\./, '');

	const figures = [
		{
			figure: '$15.4B',
			text: 'in detention and demurrage collected by nine ocean carriers, April 2020 to March 2025',
			region: 'United States',
			source: 'Federal Maritime Commission',
			href: evidence[0].href
		},
		{
			figure: '60 to 90',
			text: 'days that deposits of ₱10,000 to ₱30,000 per container are held. A draft rule would force refunds within 15 days.',
			region: 'Philippines',
			source: 'PortCalls, Feb 2026',
			href: evidence[8].href
		},
		{
			figure: '$1.5B',
			text: 'a year tied up in container deposits across East Africa',
			region: 'Kenya / East Africa',
			source: 'Nation Africa, opinion',
			href: evidence[4].href
		},
		{
			figure: '₦20bn',
			text: 'a year in un-refunded container deposits, estimated by clearing agents',
			region: 'Nigeria',
			source: 'Shipping Position, 2022',
			href: evidence[3].href
		}
	];

	// ---------------------------------------------------------------------------
	// Hero preview (illustrative data, fictional line and importer).
	// ---------------------------------------------------------------------------
	const t0 = Date.now();
	const freeTimeEnd = t0 + (4 * 24 + 6) * 3_600_000 + 12 * 60_000;
	const released = t0 - 2 * 3_600_000;

	const previewTrail: TimelineEntry[] = [
		{
			id: 'p2',
			kind: 'release',
			title: 'Release order issued',
			actor: 'Northgate Lines',
			timestamp: released + 41_000
		},
		{
			id: 'p1',
			kind: 'deposit',
			title: 'Deposit held by protocol',
			amount: 2000,
			memo: 'NGLU4829108 · BL NGLLOS2409171',
			txHash: '0x8f3a5c0e91b27d4460fa1c3398e2d5b7a61f0c94e2b8d7135a6c9f02e44bc41e',
			finalityMs: 482,
			actor: 'Adebayo Foods, via virtual address',
			timestamp: released
		}
	];

	const alternatives = [
		{
			icon: Gavel,
			title: 'Regulation',
			text: "The Philippines draft 15-day rule, Pakistan's refund order and Nigeria Shippers' Council interventions set deadlines but cannot enforce them instantly."
		},
		{
			icon: Handshake,
			title: 'Container guarantee products',
			text: 'Products like ViaTrans in Tanzania move the risk to a third party for a fee, in one market.'
		},
		{
			icon: Umbrella,
			title: 'Insurance',
			text: 'Insurance has not gained traction.'
		},
		{
			icon: Coins,
			title: 'Plain stablecoin transfers',
			text: "Fast, but the deposit still lands in the shipping line's treasury, so refunds are still at the line's discretion."
		}
	];

	const modes = [
		{
			key: 'held',
			name: 'Held deposit',
			tag: 'receive_policy' as const,
			tagLabel: 'Receive policy and guard',
			rows: [
				['For', 'New or unknown importers'],
				['What moves', 'The deposit, into the protocol guard'],
				["Line's guarantee", 'Funds already held by the protocol'],
				["Line's risk", 'None up to the deposit'],
				["Importer's benefit", 'Refund within seconds of settlement']
			]
		},
		{
			key: 'free',
			name: 'Deposit-free',
			tag: 'access_key' as const,
			tagLabel: 'Access key',
			rows: [
				['For', 'Importers with a clean track record on the platform'],
				['What moves', 'Nothing until a charge is owed'],
				["Line's guarantee", "Daily-capped pull right on the importer's account"],
				["Line's risk", 'Importer revokes the key or empties the account'],
				["Importer's benefit", 'No cash locked at all']
			]
		}
	];

	const steps = [
		{
			title: 'Release request',
			text: 'The line enters the bill of lading and containers. Free days, daily rate and deposit come from its defaults.',
			tag: 'virtual_address' as const,
			tagLabel: 'Virtual addresses'
		},
		{
			title: 'Pay or authorize',
			text: 'The importer sees the terms and approves one batch payment, or an access key, with a passkey.',
			tag: 'fee_sponsored' as const,
			tagLabel: undefined
		},
		{
			title: 'Release',
			text: 'Both sides see "Deposit held by protocol" within a second. The line issues the release order on the spot.',
			tag: 'finality' as const,
			tagLabel: undefined
		},
		{
			title: 'Free time and detention',
			text: 'A countdown runs per container. After free time, detention accrues daily, up to the deposit.',
			tag: 'recurring_limit' as const,
			tagLabel: 'Recurring limit'
		},
		{
			title: 'Return and settle',
			text: 'The line records the return receipt. Charges go to the line and the remainder back to the importer, in one transaction.',
			tag: 'recovery_authority' as const,
			tagLabel: 'Settlement contract'
		}
	];

	const rules = [
		'Free days and daily detention rate are set in the release request and shown to the importer before paying.',
		'Detention accrues per day after free time ends, up to the deposit amount.',
		"When the empty is returned, the line records the depot's return receipt: equipment interchange receipt number and date.",
		'After the return is recorded, the line has a fixed window to post final charges: 3 days by default, configurable, for example 15 days to match the Philippines draft rule. Charges cannot exceed the deposit, or the accrued detention plus a stated damage amount.',
		'At the end of the window, the remainder refunds to the importer automatically. Anyone can trigger it.',
		'Silent line: if the line never records a return, the importer can submit the return receipt themselves. The line has the same window to contest it, or the refund proceeds.',
		'Dispute: the importer can dispute posted charges once, inside the window. Disputed funds stay held; undisputed funds settle immediately. Disputes go to a resolver both sides agreed to at onboarding, the platform by default.'
	];

	const references = [
		{
			label: 'Virtual addresses',
			href: 'https://tempo.xyz/developers/docs/guide/payments/virtual-addresses'
		},
		{ label: 'Receive policies', href: 'https://tempo.xyz/blog/receive-policies/' },
		{
			label: 'Access key permissions',
			href: 'https://v3.viem.sh/tempo/guides/access-keys/permissions'
		},
		{
			label: 'Recurring limits and subscriptions',
			href: 'https://tempo.xyz/blog/subscriptions-on-tempo/'
		},
		{ label: 'Reference pattern for guard-held funds', href: 'https://github.com/emilbob/held' }
	];

	const navLinks = [
		{ href: '#problem', label: 'Problem' },
		{ href: '#evidence', label: 'Evidence' },
		{ href: '#how', label: 'How it works' },
		{ href: '#why-tempo', label: 'Why Tempo' },
		{ href: '#rules', label: 'Rules' }
	];
</script>

<svelte:head>
	<title>Portunus: container deposits, settled by protocol</title>
	<meta
		name="description"
		content="Shipping lines get guaranteed container deposits and detention charges, and importers stop locking cash for months. Built on Tempo."
	/>
</svelte:head>

<div class="landing">
	<a href="#main" class="skip-link">Skip to content</a>

	<!-- ======================================================================= -->
	<!-- Top navigation                                                          -->
	<!-- ======================================================================= -->
	<header class="topnav">
		<div class="wrap topnav-inner">
			<a href="/" class="brand" aria-label="Portunus home"><Logo size={22} label="" /></a>
			<nav aria-label="Sections" class="links">
				{#each navLinks as l (l.href)}<a href={l.href}>{l.label}</a>{/each}
			</nav>
			<div class="topnav-end">
				<span class="hide-sm"><NetworkBadge /></span>
				<ThemeToggle />
				<Button variant="primary" size="sm" href="/signin">Sign in</Button>
			</div>
		</div>
	</header>

	<main id="main">
		<!-- ===================================================================== -->
		<!-- Hero                                                                  -->
		<!-- ===================================================================== -->
		<section class="hero" aria-labelledby="hero-title">
			<div class="hero-art" aria-hidden="true">
				<svg viewBox="0 0 1200 720" preserveAspectRatio="xMidYMax slice">
					<defs>
						<radialGradient id="art-fade" cx="72%" cy="62%" r="62%">
							<stop offset="0" stop-color="#fff" stop-opacity="1" />
							<stop offset="1" stop-color="#fff" stop-opacity="0" />
						</radialGradient>
						<mask id="art-mask"><rect width="1200" height="720" fill="url(#art-fade)" /></mask>
						<pattern id="art-dots" width="24" height="24" patternUnits="userSpaceOnUse">
							<circle cx="1" cy="1" r="1" />
						</pattern>
					</defs>
					<g mask="url(#art-mask)">
						<rect width="1200" height="720" fill="url(#art-dots)" class="dots" />
						<g class="arches" fill="none">
							{#each [0, 1, 2, 3, 4, 5, 6] as i (i)}
								{@const w = 220 + i * 92}
								{@const x = 860 - w / 2}
								<path d="M{x} 720 V{430 - i * 30} a{w / 2} {w / 2} 0 0 1 {w} 0 V720" />
							{/each}
						</g>
						<g class="quay">
							<line x1="0" y1="719.5" x2="1200" y2="719.5" />
						</g>
					</g>
				</svg>
			</div>

			<div class="wrap hero-grid">
				<div class="hero-copy">
					<p class="eyebrow">
						<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
							<path
								d="M6 .9 11.1 6 6 11.1.9 6Z"
								fill="none"
								stroke="currentColor"
								stroke-width="1.3"
							/>
							<circle cx="6" cy="6" r="1.5" fill="currentColor" />
						</svg>
						Container deposits, settled by protocol
					</p>
					<h1 id="hero-title" class="display">
						Guaranteed container deposits, without locking importers' cash for months.
					</h1>
					<p class="lede">
						Shipping lines get guaranteed deposits and detention charges. Deposits are held by the
						Tempo protocol, or never move at all, and are refunded the moment the empty container is
						back.
					</p>
					<div class="hero-ctas">
						<Button variant="primary" size="lg" href="/signin" iconEnd={ArrowRight}
							>Sign in with a passkey</Button
						>
						<Button variant="secondary" size="lg" href="#evidence">See the evidence</Button>
					</div>
					<ul class="proof">
						<li>
							<ShieldCheck size={15} strokeWidth={1.75} aria-hidden="true" /> Held outside the line's
							treasury
						</li>
						<li><Zap size={15} strokeWidth={1.75} aria-hidden="true" /> Final in about 0.5 s</li>
						<li>
							<Fingerprint size={15} strokeWidth={1.75} aria-hidden="true" /> Passkeys, no gas
						</li>
					</ul>
				</div>

				<div class="hero-preview">
					<div
						class="preview-stage"
						role="img"
						aria-label="Product preview: container NGLU 482910-8 with its deposit held by the protocol, a free-time countdown and the memo trail."
					>
						<div class="preview" inert>
							<div class="pv-head">
								<div class="pv-id">
									<span class="pv-k">Container</span>
									<ContainerNumber value="NGLU4829108" type="40HC" size="lg" />
								</div>
								<StatusPill state="deposit_held" long size="md" />
							</div>
							<div class="pv-facts">
								<div>
									<span class="pv-k">Bill of lading</span><span class="mono pv-v"
										>NGLLOS2409171</span
									>
								</div>
								<div><span class="pv-k">Port</span><span class="pv-v">Apapa, Lagos</span></div>
								<div>
									<span class="pv-k">Deposit</span><span class="pv-v"><Money amount={2000} /></span>
								</div>
							</div>
							<div class="pv-grid">
								<div class="pv-cell">
									<Countdown
										target={freeTimeEnd}
										start={released}
										label="Free time ends in"
										size="md"
									/>
								</div>
								<div class="pv-cell">
									<Meter value={0} max={2000} dailyRate={150} size="sm" label="Detention accrued" />
								</div>
							</div>
							<div class="pv-trail">
								<div class="pv-trail-head">
									<span class="pv-k">Memo trail</span>
									<TempoTag feature="virtual_address" size="sm" />
								</div>
								<Timeline entries={previewTrail} animateNew={false} />
							</div>
						</div>

						<div class="float-card" inert>
							<span class="fc-icon"><CircleCheck size={16} strokeWidth={2} /></span>
							<div class="fc-body">
								<p class="fc-title">Refunded <Money amount={1550} /></p>
								<p class="fc-sub">NGLU 305571-1 · 2.8 s after settlement</p>
							</div>
							<TempoTag feature="refund_seconds" size="sm" tip={null} />
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- ===================================================================== -->
		<!-- 01 The problem                                                         -->
		<!-- ===================================================================== -->
		<section id="problem" class="section" aria-labelledby="problem-title">
			<div class="wrap split">
				<div class="split-head">
					<p class="kicker"><span class="kn">01</span> The problem</p>
					<h2 id="problem-title" class="h2">
						The box is ready to leave. The cash is not coming back soon.
					</h2>
				</div>
				<div class="split-body">
					<p class="body-lg">
						Before a shipping line releases an import container, it demands a cash deposit to
						guarantee the empty box comes back on time and undamaged. The deposit covers detention
						charges, a daily fee once the free days run out, and damage.
					</p>
					<p class="body-lg">
						The line holds the cash, often for weeks or months, and refunds slowly, partially, or in
						a different currency. While the importer waits to make the deposit, the container waits
						at the port and storage fees run.
					</p>

					<div class="parties">
						<div class="party">
							<p class="party-k">Importers and their clearing agents</p>
							<ul>
								<li>Cash tied up per container</li>
								<li>Slow and disputed refunds</li>
								<li>Release delayed while the deposit is arranged</li>
							</ul>
						</div>
						<div class="party">
							<p class="party-k">Shipping lines and their local agents</p>
							<ul>
								<li>Need a guarantee for detention and damage</li>
								<li>Chase late returns</li>
								<li>Face regulators forcing faster refunds</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- ===================================================================== -->
		<!-- 02 Evidence                                                            -->
		<!-- ===================================================================== -->
		<section id="evidence" class="section section-tint" aria-labelledby="evidence-title">
			<div class="wrap">
				<div class="section-head">
					<p class="kicker"><span class="kn">02</span> Evidence</p>
					<h2 id="evidence-title" class="h2">What the record shows, region by region.</h2>
					<p class="section-lede">
						Each figure stands on its own. They come from different sources, years and methods, so
						we never add them up. Every source is linked.
					</p>
				</div>

				<ul class="figures">
					{#each figures as f (f.figure)}
						<li class="figure">
							<p class="fig-region">{f.region}</p>
							<p class="fig-num">{f.figure}</p>
							<p class="fig-text">{f.text}</p>
							<a class="fig-src" href={f.href} target="_blank" rel="noreferrer noopener">
								{f.source}<ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
							</a>
						</li>
					{/each}
				</ul>

				<div class="ev-table-wrap">
					<table class="ev-table">
						<caption class="sr-only">Evidence by region, with source type and link</caption>
						<thead>
							<tr>
								<th scope="col">Region</th>
								<th scope="col">Evidence</th>
								<th scope="col">Source type</th>
								<th scope="col"><span class="sr-only">Link</span>Source</th>
							</tr>
						</thead>
						<tbody>
							{#each evidence as row, i (i)}
								<tr>
									<th scope="row" class="ev-region">{row.region}</th>
									<td class="ev-text">{row.evidence}</td>
									<td class="ev-source">{row.source}</td>
									<td class="ev-link">
										<a href={row.href} target="_blank" rel="noreferrer noopener">
											{domain(row.href)}<ArrowUpRight
												size={12}
												strokeWidth={2}
												aria-hidden="true"
											/>
											<span class="sr-only">(opens in a new tab)</span>
										</a>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<p class="gaps">
					<strong>Gaps we are honest about.</strong> No global total exists for deposits held or refund
					delays. The share of detention and demurrage caused by payment delays has never been measured.
				</p>
			</div>
		</section>

		<!-- ===================================================================== -->
		<!-- 03 Why existing fixes fall short                                       -->
		<!-- ===================================================================== -->
		<section id="alternatives" class="section" aria-labelledby="alt-title">
			<div class="wrap">
				<div class="section-head">
					<p class="kicker"><span class="kn">03</span> Why existing fixes fall short</p>
					<h2 id="alt-title" class="h2">
						Deadlines, third parties and faster rails still leave the refund to the line.
					</h2>
				</div>
				<ul class="alts">
					{#each alternatives as a (a.title)}
						<li class="alt">
							<span class="alt-icon"><a.icon size={18} strokeWidth={1.5} aria-hidden="true" /></span
							>
							<h3 class="h3">{a.title}</h3>
							<p>{a.text}</p>
						</li>
					{/each}
				</ul>
			</div>
		</section>

		<!-- ===================================================================== -->
		<!-- 04 How it works                                                        -->
		<!-- ===================================================================== -->
		<section id="how" class="section section-tint" aria-labelledby="how-title">
			<div class="wrap">
				<div class="section-head">
					<p class="kicker"><span class="kn">04</span> How it works</p>
					<h2 id="how-title" class="h2">Two deposit modes. The line chooses per importer.</h2>
				</div>

				<div class="modes">
					{#each modes as m (m.key)}
						<article class="mode">
							<header class="mode-head">
								<h3 class="mode-name">{m.name}</h3>
								<TempoTag feature={m.tag} label={m.tagLabel} size="sm" />
							</header>
							<dl class="mode-rows">
								{#each m.rows as [k, v] (k)}
									<div class="mode-row">
										<dt>{k}</dt>
										<dd>{v}</dd>
									</div>
								{/each}
							</dl>
						</article>
					{/each}
				</div>
				<p class="mode-note">
					A line can move an importer from held to deposit-free after a set number of clean returns,
					visible from on-chain history.
				</p>

				<ol class="steps">
					{#each steps as s, i (s.title)}
						<li class="step">
							<span class="step-n mono">{String(i + 1).padStart(2, '0')}</span>
							<h3 class="h3">{s.title}</h3>
							<p>{s.text}</p>
							<TempoTag feature={s.tag} label={s.tagLabel} size="sm" />
						</li>
					{/each}
				</ol>
			</div>
		</section>

		<!-- ===================================================================== -->
		<!-- 05 Why Tempo                                                           -->
		<!-- ===================================================================== -->
		<section id="why-tempo" class="band" aria-labelledby="tempo-title">
			<div class="wrap">
				<div class="band-head">
					<p class="kicker kicker-band"><span class="kn">05</span> Why Tempo</p>
					<h2 id="tempo-title" class="h2 band-h2">
						The guarantees Portunus needs are part of the Tempo protocol, not contracts we wrote on
						top of a chain.
					</h2>
					<p class="band-lede">
						On other stablecoin chains each of these would be custom smart-contract code that we
						would have to write, audit, and ask shipping lines to trust. On Tempo they are protocol
						behaviour.
					</p>
				</div>

				<div class="tempo-grid">
					<!-- Access keys -->
					<article class="tcard">
						<header class="tc-head">
							<span class="tc-n mono">A</span>
							<h3 class="tc-title">Access keys</h3>
						</header>
						<p class="tc-text">
							Recurring, recipient-scoped, expiring spending limits let a shipping line hold a
							guarantee over an importer's account without any cash moving.
						</p>
						<div class="tc-visual" aria-hidden="true">
							<dl class="keyspec">
								<div>
									<dt>Token</dt>
									<dd>USD stablecoin</dd>
								</div>
								<div>
									<dt>Limit</dt>
									<dd class="tabular">$150.00 per day</dd>
								</div>
								<div>
									<dt>Recipient</dt>
									<dd>Line charges address only</dd>
								</div>
								<div>
									<dt>Expiry</dt>
									<dd>Free time + max detention</dd>
								</div>
							</dl>
							<div class="refused">
								<Ban size={13} strokeWidth={2} />
								<span>Second pull today: refused by the chain</span>
							</div>
						</div>
						<p class="tc-else">Elsewhere: a custom allowance module to write and audit.</p>
					</article>

					<!-- Receive policies -->
					<article class="tcard">
						<header class="tc-head">
							<span class="tc-n mono">B</span>
							<h3 class="tc-title">Receive policies and the guard</h3>
							<span class="tc-tip mono">TIP-1028</span>
						</header>
						<p class="tc-text">
							A deposit leaves the importer without ever entering the shipping line's treasury. Only
							the settlement contract can release it: to the line for approved charges, or back to
							the payer.
						</p>
						<div class="tc-visual" aria-hidden="true">
							<svg class="flow" viewBox="0 0 320 150">
								<g class="node-g">
									<rect x="120" y="1" width="80" height="34" rx="8" class="ghost" />
									<text x="160" y="22" class="ghost-t">Line balance</text>
									<rect x="1" y="74" width="80" height="40" rx="8" />
									<text x="41" y="98">Importer</text>
									<rect x="120" y="68" width="80" height="52" rx="8" class="guard" />
									<text x="160" y="91" class="guard-t">Protocol</text>
									<text x="160" y="106" class="guard-t">guard</text>
									<rect x="239" y="48" width="80" height="34" rx="8" />
									<text x="279" y="69">To line</text>
									<rect x="239" y="106" width="80" height="34" rx="8" />
									<text x="279" y="127">To payer</text>
								</g>
								<g class="edges">
									<path d="M82 94 H118" />
									<path d="M201 86 C220 86 220 65 237 65" />
									<path d="M201 102 C220 102 220 123 237 123" />
								</g>
								<g class="blocked">
									<path d="M41 73 V18 H118" />
									<circle cx="80" cy="18" r="7" />
									<path class="x" d="M76.5 14.5 l7 7 M83.5 14.5 l-7 7" />
								</g>
							</svg>
							<p class="flow-cap">
								The receive policy keeps deposits out of the line's balance. Only the settlement
								contract releases them.
							</p>
						</div>
						<p class="tc-else">Elsewhere: an escrow contract to write, audit and trust.</p>
					</article>

					<!-- Virtual addresses -->
					<article class="tcard">
						<header class="tc-head">
							<span class="tc-n mono">C</span>
							<h3 class="tc-title">Virtual addresses</h3>
							<span class="tc-tip mono">TIP-1022</span>
						</header>
						<p class="tc-text">
							Every container gets its own deposit address with no setup cost. Payments land already
							matched to the container, with no bank details to type wrong.
						</p>
						<div class="tc-visual" aria-hidden="true">
							<ul class="vaddr">
								<li>
									<span class="mono">NGLU 482910-8</span><span class="mono va">0x7c41…09ae</span>
								</li>
								<li>
									<span class="mono">NGLU 305571-1</span><span class="mono va">0x7c41…b3d2</span>
								</li>
								<li>
									<span class="mono">NGLU 771204-9</span><span class="mono va">0x7c41…5f17</span>
								</li>
							</ul>
						</div>
						<p class="tc-else">Elsewhere: a per-address forwarder contract.</p>
					</article>

					<!-- Memos etc -->
					<article class="tcard">
						<header class="tc-head">
							<span class="tc-n mono">D</span>
							<h3 class="tc-title">Memos, batch, fee sponsorship, passkeys</h3>
						</header>
						<p class="tc-text">
							Memos, batch transactions, fee sponsorship, passkeys and fast deterministic finality
							make it usable by clearing agents and line staff who have never touched crypto.
						</p>
						<div class="tc-visual" aria-hidden="true">
							<ul class="chips">
								<li>Memo: container and B/L <span class="mono">TIP-20</span></li>
								<li>One batch per bill of lading</li>
								<li>Fee sponsored, no gas</li>
								<li>Face ID or fingerprint</li>
								<li>Final in about 0.5 s</li>
							</ul>
						</div>
						<p class="tc-else">
							Every deposit, charge and refund carries the same record for both sides.
						</p>
					</article>
				</div>

				<div class="band-foot">
					<p>{TEMPO_PROTOCOL_NOTE}</p>
					<ul class="refs">
						{#each references as r (r.href)}
							<li>
								<a href={r.href} target="_blank" rel="noreferrer noopener">
									{r.label}<ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
								</a>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</section>

		<!-- ===================================================================== -->
		<!-- 06 Settlement rules                                                    -->
		<!-- ===================================================================== -->
		<section id="rules" class="section" aria-labelledby="rules-title">
			<div class="wrap split">
				<div class="split-head sticky">
					<p class="kicker"><span class="kn">06</span> Settlement rules</p>
					<h2 id="rules-title" class="h2">Fixed rules, shown to both sides up front.</h2>
					<p class="section-lede">
						The settlement contract splits held deposits between the line and the importer under
						fixed rules. Both sides see them before any money moves.
					</p>
				</div>
				<ol class="rules">
					{#each rules as r, i (i)}
						<li>
							<span class="rule-n mono">{String(i + 1).padStart(2, '0')}</span>
							<p>{r}</p>
						</li>
					{/each}
				</ol>
			</div>
		</section>

		<!-- ===================================================================== -->
		<!-- CTA                                                                    -->
		<!-- ===================================================================== -->
		<section class="section cta-section" aria-labelledby="cta-title">
			<div class="wrap">
				<div class="cta">
					<div class="cta-copy">
						<Logo variant="mark" size={36} label="" />
						<h2 id="cta-title" class="h2">Sign in with a passkey.</h2>
						<p>
							No seed phrases and no gas. Line staff and clearing agents approve with Face ID or a
							fingerprint.
						</p>
					</div>
					<div class="cta-action">
						<PasskeyButton href="/signin" />
						<span class="cta-net"><NetworkBadge /></span>
					</div>
				</div>
			</div>
		</section>
	</main>

	<footer class="footer">
		<div class="wrap footer-inner">
			<div class="f-brand">
				<Logo size={20} />
				<p>Portunus is the Roman god of keys, doors and harbours. His symbol is a key.</p>
			</div>
			<div class="f-meta">
				<p>
					Hackathon build on Tempo Moderato testnet. Memos and amounts are public on testnet. Out of
					scope: cargo condition, customs duties, freight payments.
				</p>
				<a href="/styleguide">Design system</a>
			</div>
		</div>
	</footer>
</div>

<style>
	/* ---------- frame ---------- */
	.wrap {
		width: 100%;
		max-width: calc(var(--page-max) + var(--gutter) * 2);
		margin: 0 auto;
		padding: 0 var(--gutter);
	}

	.landing {
		font-size: var(--text-md);
		line-height: var(--leading-md);
	}

	/* ---------- top nav ---------- */
	.topnav {
		position: sticky;
		top: 0;
		z-index: var(--z-nav);
		border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
		background: color-mix(in srgb, var(--color-bg) 84%, transparent);
		backdrop-filter: saturate(1.4) blur(12px);
		-webkit-backdrop-filter: saturate(1.4) blur(12px);
	}

	.topnav-inner {
		display: flex;
		align-items: center;
		gap: var(--space-8);
		height: 3.75rem;
	}

	.brand {
		display: inline-flex;
		color: inherit;
		border-radius: var(--radius-sm);
	}

	.brand:hover {
		text-decoration: none;
	}

	.links {
		display: flex;
		gap: var(--space-6);
		margin-right: auto;
	}

	.links a {
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}

	.links a:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.topnav-end {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}

	/* ---------- type ---------- */
	.display {
		font-family: var(--font-display);
		font-size: clamp(2.375rem, 1.5rem + 2.7vw, 3.625rem);
		line-height: 1.02;
		font-weight: 460;
		letter-spacing: -0.028em;
		font-variation-settings: 'opsz' 72;
	}

	.h2 {
		font-family: var(--font-display);
		font-size: clamp(1.875rem, 1.3rem + 1.8vw, 2.75rem);
		line-height: 1.08;
		font-weight: 470;
		letter-spacing: -0.022em;
		font-variation-settings: 'opsz' 60;
	}

	.h3 {
		font-size: var(--text-md);
		line-height: var(--leading-md);
		font-weight: var(--weight-semibold);
		letter-spacing: -0.01em;
	}

	.kicker {
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
		margin-bottom: var(--space-4);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-secondary);
	}

	.kn {
		font-family: var(--font-mono);
		font-weight: 500;
		letter-spacing: 0;
		color: var(--color-accent-text);
	}

	.kn::after {
		content: '';
		display: inline-block;
		width: 1.5rem;
		height: 1px;
		margin-left: var(--space-2-5);
		vertical-align: middle;
		background: var(--color-border-strong);
	}

	.body-lg {
		font-size: var(--text-lg);
		line-height: 1.65;
		color: var(--color-text-secondary);
	}

	.body-lg + .body-lg {
		margin-top: var(--space-4);
	}

	.section-lede {
		max-width: 40rem;
		margin-top: var(--space-4);
		font-size: var(--text-md);
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	/* ---------- hero ---------- */
	.hero {
		position: relative;
		overflow: hidden;
		padding: clamp(3rem, 7vw, 6.5rem) 0 clamp(3.5rem, 7vw, 6rem);
		border-bottom: 1px solid var(--color-border);
	}

	.hero-art {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.hero-art svg {
		width: 100%;
		height: 100%;
	}

	.hero-art .dots {
		fill: var(--color-border-strong);
		opacity: 0.5;
	}

	.hero-art .arches path {
		stroke: var(--color-border-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.hero-art .quay line {
		stroke: var(--color-border-strong);
	}

	.hero-grid {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
		gap: clamp(2.5rem, 5vw, 5rem);
		align-items: center;
	}

	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-6);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--tone-protocol-border);
		border-radius: var(--radius-full);
		background: var(--tone-protocol-bg);
		color: var(--tone-protocol-fg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}

	.lede {
		max-width: 34rem;
		margin-top: var(--space-6);
		font-size: var(--text-lg);
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.hero-ctas {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-8);
	}

	.proof {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-6);
		margin-top: var(--space-8);
		padding-top: var(--space-6);
		border-top: 1px solid var(--color-border);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.proof li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.proof :global(svg) {
		color: var(--color-accent);
	}

	/* preview */
	.hero-preview {
		position: relative;
	}

	.preview-stage {
		position: relative;
		padding-bottom: 3.75rem;
	}

	.preview {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow:
			var(--shadow-lg),
			0 40px 80px -40px rgba(16, 20, 26, 0.25);
		font-size: var(--text-sm);
		line-height: var(--leading-sm);
		overflow: hidden;
	}

	.pv-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-5) var(--space-4);
	}

	.pv-id {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.pv-k {
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.pv-facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		border-top: 1px solid var(--color-border-subtle);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.pv-facts > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-3) var(--space-5);
		min-width: 0;
	}

	.pv-facts > div + div {
		border-left: 1px solid var(--color-border-subtle);
	}

	.pv-v {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pv-v.mono {
		font-size: 0.75rem;
	}

	.pv-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.pv-cell {
		padding: var(--space-4) var(--space-5);
		min-width: 0;
	}

	.pv-cell + .pv-cell {
		border-left: 1px solid var(--color-border-subtle);
	}

	.pv-trail {
		padding: var(--space-4) var(--space-5) var(--space-5);
		background: color-mix(in srgb, var(--color-surface-sunken) 45%, var(--color-surface));
	}

	.pv-trail-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.float-card {
		position: absolute;
		left: calc(var(--space-8) * -1);
		bottom: 0;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-3) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-overlay);
		font-size: var(--text-sm);
		line-height: var(--leading-sm);
	}

	.fc-icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-md);
		background: var(--tone-success-bg);
		color: var(--tone-success-solid);
	}

	.fc-title {
		font-weight: var(--weight-semibold);
	}

	.fc-sub {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	/* ---------- sections ---------- */
	.section {
		padding: clamp(4rem, 9vw, 7.5rem) 0;
	}

	.section-tint {
		background: var(--color-bg-elevated);
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	.section-head {
		max-width: 46rem;
		margin-bottom: clamp(2.5rem, 5vw, 3.5rem);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		gap: clamp(2rem, 6vw, 6rem);
	}

	.split-head.sticky {
		position: sticky;
		top: 6rem;
		align-self: start;
	}

	/* problem */
	.parties {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
		margin-top: var(--space-10);
	}

	.party {
		padding: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.party-k {
		margin-bottom: var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.party li {
		position: relative;
		padding: var(--space-2) 0 var(--space-2) var(--space-5);
		border-top: 1px solid var(--color-border-subtle);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.party li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 50%;
		width: 8px;
		height: 1px;
		background: var(--color-text-tertiary);
	}

	/* evidence */
	.figures {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		border-top: 1px solid var(--color-text);
		margin-bottom: var(--space-12);
	}

	.figure {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-5) var(--space-6) 0;
	}

	.figure + .figure {
		padding-left: var(--space-5);
		border-left: 1px solid var(--color-border);
	}

	.fig-region {
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.fig-num {
		font-family: var(--font-display);
		font-size: clamp(2.25rem, 1.6rem + 1.6vw, 3.25rem);
		line-height: 1.05;
		font-weight: 450;
		letter-spacing: -0.03em;
		font-variant-numeric: lining-nums tabular-nums;
		color: var(--color-text);
	}

	.fig-text {
		font-size: var(--text-sm);
		line-height: 1.55;
		color: var(--color-text-secondary);
	}

	.fig-src,
	.ev-link a,
	.refs a {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}

	.fig-src {
		margin-top: auto;
		padding-top: var(--space-2);
	}

	.ev-table-wrap {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.ev-table {
		width: 100%;
		font-size: var(--text-sm);
		line-height: 1.55;
	}

	.ev-table thead th {
		padding: var(--space-2-5) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-sunken);
		color: var(--color-text-tertiary);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		text-align: left;
		white-space: nowrap;
	}

	.ev-table tbody th,
	.ev-table td {
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border-subtle);
		vertical-align: top;
		text-align: left;
	}

	.ev-table tbody tr:last-child > * {
		border-bottom: 0;
	}

	.ev-table tbody tr:hover > * {
		background: var(--color-surface-hover);
	}

	.ev-region {
		width: 15%;
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.ev-text {
		width: 50%;
		color: var(--color-text);
	}

	.ev-source {
		width: 20%;

		color: var(--color-text-secondary);
		font-size: var(--text-xs);
		line-height: 1.55;
	}

	.ev-link {
		width: 15%;
		white-space: nowrap;
	}

	.gaps {
		max-width: 46rem;
		margin-top: var(--space-6);
		padding-left: var(--space-4);
		border-left: 2px solid var(--color-border-strong);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.gaps strong {
		color: var(--color-text);
		font-weight: var(--weight-semibold);
	}

	/* alternatives */
	.alts {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
	}

	.alt {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-6) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.alt p {
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.alt-icon {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		margin-bottom: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
	}

	/* modes */
	.modes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	.mode {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.mode-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-6);
		border-bottom: 1px solid var(--color-border);
	}

	.mode-name {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 500;
		letter-spacing: -0.015em;
	}

	.mode-row {
		display: grid;
		grid-template-columns: 9rem 1fr;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-6);
		font-size: var(--text-sm);
	}

	.mode-row + .mode-row {
		border-top: 1px solid var(--color-border-subtle);
	}

	.mode-row dt {
		color: var(--color-text-tertiary);
	}

	.mode-row dd {
		margin: 0;
		color: var(--color-text);
		font-weight: var(--weight-medium);
	}

	.mode-note {
		margin-top: var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		margin-top: clamp(3rem, 6vw, 4.5rem);
		border-top: 1px solid var(--color-border);
		counter-reset: step;
	}

	.step {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-6) var(--space-5) 0 0;
	}

	.step + .step {
		padding-left: var(--space-5);
		border-left: 1px solid var(--color-border-subtle);
	}

	.step::before {
		content: '';
		position: absolute;
		top: -4px;
		left: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-bg-elevated);
	}

	.step + .step::before {
		left: -4px;
	}

	.step-n {
		font-size: var(--text-xs);
		color: var(--color-accent-text);
	}

	.step p {
		flex: 1;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--color-text-secondary);
		margin-bottom: var(--space-2);
	}

	/* ---------- Why Tempo band ---------- */
	.band {
		padding: clamp(4.5rem, 9vw, 8rem) 0;
		background: var(--color-band-bg);
		color: var(--color-band-text);
		border-top: 1px solid var(--color-band-border);
		border-bottom: 1px solid var(--color-band-border);
	}

	.band-head {
		max-width: 52rem;
		margin-bottom: clamp(2.5rem, 5vw, 4rem);
	}

	.kicker-band {
		color: var(--color-band-text-secondary);
	}

	.kicker-band .kn {
		color: var(--color-band-accent);
	}

	.kicker-band .kn::after {
		background: var(--color-band-border);
	}

	.band-h2 {
		color: var(--color-band-text);
	}

	.band-lede {
		max-width: 42rem;
		margin-top: var(--space-5);
		font-size: var(--text-lg);
		line-height: 1.6;
		color: var(--color-band-text-secondary);
	}

	.tempo-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		border: 1px solid var(--color-band-border);
		border-radius: var(--radius-xl);
		background: var(--color-band-border);
		overflow: hidden;
	}

	.tcard {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-8);
		background: var(--color-band-bg);
	}

	.tc-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.tc-n {
		display: grid;
		place-items: center;
		width: 1.625rem;
		height: 1.625rem;
		border: 1px solid var(--color-band-border);
		border-radius: var(--radius-sm);
		color: var(--color-band-accent);
		font-size: var(--text-xs);
	}

	.tc-title {
		color: var(--color-band-text);
		font-size: var(--text-lg);
		line-height: var(--leading-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: -0.012em;
	}

	.tc-tip {
		margin-left: auto;
		white-space: nowrap;
		padding: 2px 8px;
		border: 1px solid color-mix(in srgb, var(--color-band-accent) 40%, transparent);
		border-radius: var(--radius-sm);
		color: var(--color-band-accent);
		font-size: var(--text-xs);
	}

	.tc-text {
		max-width: 32rem;
		font-size: var(--text-base);
		line-height: 1.65;
		color: var(--color-band-text-secondary);
	}

	.tc-visual {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-3);
		min-height: 9.5rem;
		padding: var(--space-5);
		border: 1px solid var(--color-band-border);
		border-radius: var(--radius-lg);
		background: var(--color-band-surface);
	}

	.tc-else {
		font-size: var(--text-xs);
		color: var(--color-band-text-secondary);
		opacity: 0.85;
	}

	.keyspec {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3) var(--space-5);
	}

	.keyspec div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.keyspec dt {
		font-size: var(--text-2xs);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-band-text-secondary);
	}

	.keyspec dd {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-band-text);
	}

	.refused {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		align-self: flex-start;
		margin-top: var(--space-1);
		padding: 3px 10px;
		border-radius: var(--radius-full);
		background: rgba(229, 87, 74, 0.14);
		color: #f59a90;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}

	.flow {
		width: 100%;
		max-width: 22rem;
		height: auto;
		margin: 0 auto;
		overflow: visible;
	}

	.flow .node-g rect {
		fill: rgba(255, 255, 255, 0.04);
		stroke: var(--color-band-border);
	}

	.flow .node-g rect.guard {
		fill: color-mix(in srgb, var(--color-band-accent) 14%, transparent);
		stroke: color-mix(in srgb, var(--color-band-accent) 55%, transparent);
	}

	.flow text {
		fill: var(--color-band-text);
		font-size: 11.5px;
		font-family: var(--font-sans);
		font-weight: 500;
		text-anchor: middle;
	}

	.flow text.guard-t {
		fill: var(--color-band-accent);
	}

	.flow .edges path {
		fill: none;
		stroke: var(--color-band-accent);
		stroke-width: 1.25;
		marker-end: none;
	}

	.flow .blocked path {
		fill: none;
		stroke: #e5574a;
		stroke-width: 1.25;
		stroke-dasharray: 3 3;
	}

	.flow .blocked circle {
		fill: var(--color-band-bg);
		stroke: #e5574a;
		stroke-width: 1.25;
	}

	.flow .blocked path.x {
		stroke-dasharray: none;
	}

	.flow .node-g rect.ghost {
		fill: none;
		stroke-dasharray: 3 3;
	}

	.flow text.ghost-t {
		fill: var(--color-band-text-secondary);
	}

	.flow-cap {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--color-band-text-secondary);
	}

	.vaddr {
		display: flex;
		flex-direction: column;
	}

	.vaddr li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2-5) 0;
		font-size: 0.8125rem;
		color: var(--color-band-text);
	}

	.vaddr li + li {
		border-top: 1px dashed var(--color-band-border);
	}

	.vaddr .va {
		color: var(--color-band-accent);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.chips li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 5px 10px;
		border: 1px solid var(--color-band-border);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-band-text);
	}

	.chips .mono {
		color: var(--color-band-accent);
		font-size: 0.6875rem;
	}

	.band-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4) var(--space-8);
		margin-top: var(--space-8);
		font-size: var(--text-sm);
		color: var(--color-band-text-secondary);
	}

	.refs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
	}

	.refs a {
		color: var(--color-band-accent);
	}

	/* rules */
	.rules {
		border-top: 1px solid var(--color-text);
	}

	.rules li {
		display: grid;
		grid-template-columns: 3rem 1fr;
		gap: var(--space-4);
		padding: var(--space-5) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.rule-n {
		padding-top: 3px;
		font-size: var(--text-xs);
		color: var(--color-accent-text);
	}

	.rules p {
		font-size: var(--text-md);
		line-height: 1.65;
		color: var(--color-text);
	}

	/* CTA */
	.cta-section {
		padding-top: 0;
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-8);
		padding: clamp(2rem, 5vw, 3.5rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.cta-copy {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 32rem;
	}

	.cta-copy p {
		color: var(--color-text-secondary);
	}

	.cta-action {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
	}

	/* footer */
	.footer {
		padding: var(--space-10) 0 var(--space-12);
		border-top: 1px solid var(--color-border);
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}

	.footer-inner {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-6);
	}

	.f-brand {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 22rem;
	}

	.f-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		max-width: 30rem;
	}

	/* ---------- responsive ---------- */
	@media (max-width: 1080px) {
		.links {
			display: none;
		}

		.hero-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.hero-preview {
			max-width: 38rem;
		}

		.float-card {
			left: auto;
			right: var(--space-4);
		}

		.figures {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.figure:nth-child(3) {
			padding-left: 0;
			border-left: 0;
		}

		.figure:nth-child(n + 3) {
			border-top: 1px solid var(--color-border);
		}

		.alts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.steps {
			grid-template-columns: minmax(0, 1fr);
			border-top: 0;
			border-left: 1px solid var(--color-border);
			gap: 0;
		}

		.step,
		.step + .step {
			padding: 0 0 var(--space-6) var(--space-6);
			border-left: 0;
		}

		.step::before,
		.step + .step::before {
			left: -4px;
			top: 6px;
		}
	}

	@media (min-width: 861px) {
		.ev-table td.ev-source {
			padding-top: calc(var(--space-4) + 2px);
		}
	}

	@media (max-width: 860px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}

		.split-head.sticky {
			position: static;
		}

		.modes,
		.tempo-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		/* evidence table becomes stacked rows */
		.ev-table thead {
			display: none;
		}

		.ev-table,
		.ev-table tbody,
		.ev-table tr,
		.ev-table th,
		.ev-table td {
			display: block;
			width: auto;
		}

		.ev-table tr {
			padding: var(--space-4) var(--space-5);
			border-bottom: 1px solid var(--color-border-subtle);
		}

		.ev-table tbody th,
		.ev-table td {
			padding: 0;
			border: 0;
		}

		.ev-table tbody tr:hover > * {
			background: none;
		}

		.ev-region {
			font-size: var(--text-xs);
			letter-spacing: var(--tracking-caps);
			text-transform: uppercase;
			color: var(--color-text-tertiary);
			margin-bottom: var(--space-1);
		}

		.ev-source {
			margin-top: var(--space-2);
		}

		.ev-link {
			margin-top: var(--space-1);
		}
	}

	@media (max-width: 640px) {
		.hide-sm {
			display: none;
		}

		.topnav-inner {
			gap: var(--space-3);
		}

		.figures,
		.alts,
		.parties {
			grid-template-columns: minmax(0, 1fr);
		}

		.figure,
		.figure + .figure {
			padding: var(--space-5) 0;
			border-left: 0;
		}

		.figure + .figure {
			border-top: 1px solid var(--color-border);
		}

		.pv-facts {
			grid-template-columns: 1fr 1fr;
		}

		.pv-facts > div:nth-child(3) {
			display: none;
		}

		.pv-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.pv-cell + .pv-cell {
			border-left: 0;
			border-top: 1px solid var(--color-border-subtle);
		}

		.float-card {
			position: relative;
			right: auto;
			margin: calc(var(--space-6) * -1) var(--space-3) 0;
		}

		.preview-stage {
			padding-bottom: 0;
		}

		.mode-row {
			grid-template-columns: minmax(0, 1fr);
			gap: 2px;
		}

		.tcard {
			padding: var(--space-6) var(--space-5);
		}

		.keyspec {
			grid-template-columns: minmax(0, 1fr);
		}

		.cta-action {
			align-items: stretch;
			width: 100%;
		}

		.hero-ctas {
			flex-direction: column;
			align-items: stretch;
		}

		.hero-ctas :global(.btn) {
			width: 100%;
		}
	}
</style>
