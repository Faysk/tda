import Image from "next/image";
import { PIPIPI_CINEMATIC_ART_DIRECTION } from "../art-directions/pipipi";
import { PIPIPI_STORY, type PipipiSceneId } from "../pipipi-story";
import { PipipiCinematicScene } from "./pipipi-cinematic-scene";
import styles from "./pipipi-lore-page.module.css";
import mobileStyles from "./pipipi-lore-mobile.module.css";

const sceneConfig: Record<
	PipipiSceneId,
	{
		background: string;
		subject?: string;
		subjectWidth?: number;
		subjectHeight?: number;
		title: string;
		eyebrow: string;
		caption: string;
		motion: "breath" | "soft" | "cinematic" | "showcase";
	}
> = {
	casa: {
		background: "/lore/pipipi/casa-bg.avif",
		subject: "/lore/pipipi/casa-subject.avif",
		subjectWidth: 541,
		subjectHeight: 680,
		title: "A Casa tinha outro nome",
		eyebrow: "02 · O outro nome da Casa",
		caption:
			"A Casa tinha corredores, quartos, brinquedos e crianças. Também tinha outro nome.",
		motion: "cinematic",
	},
	"super-herois": {
		background: "/lore/pipipi/super-bg.avif",
		subject: "/lore/pipipi/super-subject.avif",
		subjectWidth: 544,
		subjectHeight: 680,
		title: "Os super-heróis não vieram salvá-la",
		eyebrow: "A mesma memória, outro significado",
		caption:
			"As fantasias não eram reais. O carinho, a presença e o heroísmo talvez fossem.",
		motion: "cinematic",
	},
	corredores: {
		background: "/lore/pipipi/corredores-bg.avif",
		subject: "/lore/pipipi/corredores-subject.avif",
		subjectWidth: 551,
		subjectHeight: 680,
		title: "Algumas crianças nunca foram para casa",
		eyebrow: "Memória · corredores",
		caption:
			"Pipipi conhecia os corredores e recebia as crianças novas como se a Casa fosse realmente dela.",
		motion: "showcase",
	},
	cadeira: {
		background: "/lore/pipipi/cadeira-bg.avif",
		subject: "/lore/pipipi/cadeira-subject.avif",
		subjectWidth: 631,
		subjectHeight: 680,
		title: "A cadeira",
		eyebrow: "Ficar também era cuidar",
		caption:
			"Uma cama boa ao lado. Uma cadeira ruim. E uma mãe que preferia continuar perto.",
		motion: "breath",
	},
	"ultimo-dia": {
		background: "/lore/pipipi/ultimo-dia-bg.avif",
		subject: "/lore/pipipi/ultimo-dia-subject.avif",
		subjectWidth: 544,
		subjectHeight: 680,
		title: "O último dia",
		eyebrow: "Todo mundo ficou",
		caption:
			"Pipipi finalmente teve a plateia que queria, sem saber por que ninguém ousaria sair dali.",
		motion: "breath",
	},
	acordou: {
		background: "/lore/pipipi/acordou-bg.avif",
		subject: "/lore/pipipi/acordou-subject.avif",
		subjectWidth: 551,
		subjectHeight: 680,
		title: "Quando Pipipi acordou",
		eyebrow: "Pela primeira vez em muito tempo, nada doía",
		caption: "Quando abriu os olhos novamente, Pipipi estava leve.",
		motion: "cinematic",
	},
};

const ghostAfterSection: Record<
	string,
	{ src: string; position: "left" | "right"; width: number; height: number }
> = {
	"o-que-ficou-depois-da-morte": {
		src: "/lore/pipipi/ghost-soft.avif",
		position: "right",
		width: 600,
		height: 597,
	},
	"a-ferida-que-pipipi-nunca-nomeou": {
		src: "/lore/pipipi/ghost-cry.avif",
		position: "left",
		width: 596,
		height: 600,
	},
	"pipipi-e-dandelion": {
		src: "/lore/pipipi/ghost-flute.avif",
		position: "right",
		width: 589,
		height: 600,
	},
	"a-pulseirinha": {
		src: "/lore/pipipi/ghost-surprise.avif",
		position: "left",
		width: 600,
		height: 590,
	},
	"o-coracao-de-pipipi": {
		src: "/lore/pipipi/ghost-hearts.avif",
		position: "right",
		width: 560,
		height: 600,
	},
};

function renderInlineMarkup(text: string, keyPrefix: string) {
	return text
		.split(/(<strong>[\s\S]*?<\/strong>)/g)
		.filter(Boolean)
		.map((part) => {
			const strong = part.match(/^<strong>([\s\S]*)<\/strong>$/);
			return strong ? (
				<strong key={`${keyPrefix}:strong:${strong[1]}`}>{strong[1]}</strong>
			) : (
				part
			);
		});
}

/**
 * O pack editorial versionado usa apenas p, blockquote e strong.
 * Renderizamos esse subconjunto explicitamente como React para manter o texto
 * aprovado sem abrir uma superfície de HTML arbitrário no runtime.
 */
function EditorialContent({ html }: { html: string }) {
	const blocks = [
		...html.matchAll(
			/<blockquote><p>([\s\S]*?)<\/p><\/blockquote>|<p>([\s\S]*?)<\/p>/g,
		),
	];

	return blocks.map((match) => {
		const isQuote = match[1] !== undefined;
		const text = match[1] ?? match[2] ?? "";
		const blockKey = `${isQuote ? "quote" : "paragraph"}:${text}`;
		const content = renderInlineMarkup(text, blockKey);

		return isQuote ? (
			<blockquote key={blockKey}>
				<p>{content}</p>
			</blockquote>
		) : (
			<p key={blockKey}>{content}</p>
		);
	});
}

function StorySection({
	section,
}: {
	section: (typeof PIPIPI_STORY.parts)[number]["sections"][number];
}) {
	const ghost = ghostAfterSection[section.id];
	return (
		<>
			<section
				className={`${styles.storySection} ${section.major ? styles.storySectionMajor : ""}`}
				id={section.id}
			>
				<header>
					<h2>{section.title}</h2>
				</header>
				<div className={styles.prose}>
					<EditorialContent html={section.html} />
				</div>
			</section>

			{section.sceneAfter ? (
				<PipipiCinematicScene
					id={section.sceneAfter}
					{...sceneConfig[section.sceneAfter]}
					artDirection={PIPIPI_CINEMATIC_ART_DIRECTION[section.sceneAfter]}
				/>
			) : null}

			{ghost ? (
				<aside
					className={`${styles.ghostInterlude} ${ghost.position === "left" ? styles.ghostInterludeLeft : styles.ghostInterludeRight}`}
					aria-hidden="true"
				>
					<Image
						src={ghost.src}
						alt=""
						width={ghost.width}
						height={ghost.height}
						sizes="(max-width: 760px) 52vw, 30vw"
					/>
				</aside>
			) : null}
		</>
	);
}

function PartHeader({ part }: { part: (typeof PIPIPI_STORY.parts)[number] }) {
	return (
		<header className={styles.partHeader} id={part.id}>
			<span className={styles.partNumber}>{part.number}</span>
			<div>
				<p>{part.eyebrow}</p>
				<h2>{part.title}</h2>
				<p className={styles.partDescription}>{part.description}</p>
			</div>
		</header>
	);
}

export function PipipiLorePage() {
	return (
		<article className={styles.page}>
			<header className={styles.hero} id="topo">
				<Image
					className={styles.heroBackground}
					src="/lore/pipipi/stage-bg.avif"
					alt=""
					fill
					priority
					sizes="100vw"
					quality={88}
				/>
				<div className={styles.heroShade} />
				<div className={styles.heroCopy}>
					<p className={styles.heroEyebrow}>{PIPIPI_STORY.hero.eyebrow}</p>
					<h1>
						A Casa Onde os <span>Super-Heróis Visitavam</span>
					</h1>
					<blockquote>{PIPIPI_STORY.hero.quote}</blockquote>
					<p className={styles.heroAttribution}>— {PIPIPI_STORY.hero.attribution}</p>
					<a className={styles.heroCta} href="#parte-01">
						Começar a história ↓
					</a>
				</div>
				<div className={styles.heroGhost} aria-hidden="true">
					<Image
						src="/lore/pipipi/ghost-flute.avif"
						alt=""
						width={589}
						height={600}
						priority
						sizes="(max-width: 760px) 62vw, 34vw"
					/>
				</div>
				<div className={styles.heroScrollCue} aria-hidden="true">
					<span />
				</div>
			</header>

			<nav
				className={`${styles.chapterNav} ${mobileStyles.chapterNav}`}
				aria-label="Capítulos da história"
			>
				{PIPIPI_STORY.parts.map((part) => (
					<a key={part.id} href={`#${part.id}`}>
						<span>{part.number}</span> {part.title}
					</a>
				))}
			</nav>

			<div className={styles.story}>
				<PartHeader part={PIPIPI_STORY.parts[0]} />
				<div className={styles.memoryAct}>
					{PIPIPI_STORY.parts[0].sections.map((section) => (
						<StorySection key={section.id} section={section} />
					))}
				</div>

				<aside className={styles.turningPoint}>
					<span>✦</span>
					<p>{PIPIPI_STORY.turningPoint.kicker}</p>
					<h2>{PIPIPI_STORY.turningPoint.title}</h2>
					<div className={styles.turningPointText}>
						<EditorialContent html={PIPIPI_STORY.turningPoint.html} />
					</div>
				</aside>

				<PartHeader part={PIPIPI_STORY.parts[1]} />
				<div className={styles.truthAct}>
					{PIPIPI_STORY.parts[1].sections.map((section) => (
						<StorySection key={section.id} section={section} />
					))}
				</div>

				<section className={styles.ghostArrival} aria-label="Pipipi depois da morte">
					<div className={styles.ghostArrivalCopy}>
						<p>Depois daquele quarto</p>
						<h2>Algumas coisas terminaram naquele quarto. Outras continuaram voando com ela.</h2>
					</div>
					<Image
						src="/lore/pipipi/acordou-subject.avif"
						alt="Pipipi como um pequeno fantasminha verde e luminoso."
						width={551}
						height={680}
						sizes="(max-width: 760px) 66vw, 38vw"
					/>
				</section>

				<PartHeader part={PIPIPI_STORY.parts[2]} />
				<div className={styles.afterAct}>
					{PIPIPI_STORY.parts[2].sections.map((section) => (
						<StorySection key={section.id} section={section} />
					))}
				</div>

				<section className={styles.finale}>
					<Image
						src="/lore/pipipi/ghost-soft.avif"
						alt=""
						width={600}
						height={597}
						aria-hidden="true"
					/>
					<div className={styles.finaleCopy}>
						<div>
							<EditorialContent html={PIPIPI_STORY.finaleHtml} />
						</div>
						<strong>Quando você não consegue salvar alguém, ainda pode ficar.</strong>
					</div>
				</section>
			</div>
		</article>
	);
}
