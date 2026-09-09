import Image from "next/image";
import { PIPIPI_STORY, type PipipiSceneId } from "../pipipi-story";
import { PipipiCinematicScene } from "./pipipi-cinematic-scene";
import styles from "./pipipi-lore-page.module.css";

const sceneConfig: Record<
	PipipiSceneId,
	{
		background: string;
		subject?: string;
		title: string;
		eyebrow: string;
		caption: string;
		motion: "breath" | "soft" | "cinematic" | "showcase";
	}
> = {
	casa: {
		background: "/lore/pipipi/casa-bg.avif",
		subject: "/lore/pipipi/casa-subject.avif",
		title: "A Casa tinha outro nome",
		eyebrow: "02 · O outro nome da Casa",
		caption:
			"A Casa tinha corredores, quartos, brinquedos e crianças. Também tinha outro nome.",
		motion: "cinematic",
	},
	"super-herois": {
		background: "/lore/pipipi/super-bg.avif",
		subject: "/lore/pipipi/super-subject.avif",
		title: "Os super-heróis não vieram salvá-la",
		eyebrow: "A mesma memória, outro significado",
		caption:
			"As fantasias não eram reais. O carinho, a presença e o heroísmo talvez fossem.",
		motion: "cinematic",
	},
	corredores: {
		background: "/lore/pipipi/corredores-bg.avif",
		subject: "/lore/pipipi/corredores-subject.avif",
		title: "Algumas crianças nunca foram para casa",
		eyebrow: "Memória · corredores",
		caption:
			"Pipipi conhecia os corredores e recebia as crianças novas como se a Casa fosse realmente dela.",
		motion: "showcase",
	},
	cadeira: {
		background: "/lore/pipipi/cadeira-bg.avif",
		subject: "/lore/pipipi/cadeira-subject.avif",
		title: "A cadeira",
		eyebrow: "Ficar também era cuidar",
		caption:
			"Uma cama boa ao lado. Uma cadeira ruim. E uma mãe que preferia continuar perto.",
		motion: "breath",
	},
	"ultimo-dia": {
		background: "/lore/pipipi/ultimo-dia-bg.avif",
		subject: "/lore/pipipi/ultimo-dia-subject.avif",
		title: "O último dia",
		eyebrow: "Todo mundo ficou",
		caption:
			"Pipipi finalmente teve a plateia que queria, sem saber por que ninguém ousaria sair dali.",
		motion: "breath",
	},
	acordou: {
		background: "/lore/pipipi/acordou-bg.avif",
		subject: "/lore/pipipi/acordou-subject.avif",
		title: "Quando Pipipi acordou",
		eyebrow: "Pela primeira vez em muito tempo, nada doía",
		caption: "Quando abriu os olhos novamente, Pipipi estava leve.",
		motion: "cinematic",
	},
};

const ghostAfterSection: Record<string, { src: string; position: "left" | "right" }> = {
	"o-que-ficou-depois-da-morte": {
		src: "/lore/pipipi/ghost-soft.avif",
		position: "right",
	},
	"a-ferida-que-pipipi-nunca-nomeou": {
		src: "/lore/pipipi/ghost-cry.avif",
		position: "left",
	},
	"pipipi-e-dandelion": {
		src: "/lore/pipipi/ghost-flute.avif",
		position: "right",
	},
	"a-pulseirinha": {
		src: "/lore/pipipi/ghost-surprise.avif",
		position: "left",
	},
	"o-coracao-de-pipipi": {
		src: "/lore/pipipi/ghost-hearts.avif",
		position: "right",
	},
};

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
				<div
					className={styles.prose}
					// Conteúdo editorial estático e versionado; não recebe HTML de usuário.
					dangerouslySetInnerHTML={{ __html: section.html }}
				/>
			</section>

			{section.sceneAfter ? (
				<PipipiCinematicScene id={section.sceneAfter} {...sceneConfig[section.sceneAfter]} />
			) : null}

			{ghost ? (
				<aside
					className={`${styles.ghostInterlude} ${ghost.position === "left" ? styles.ghostInterludeLeft : styles.ghostInterludeRight}`}
					aria-hidden="true"
				>
					<Image src={ghost.src} alt="" width={760} height={760} sizes="(max-width: 760px) 52vw, 30vw" />
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
						width={962}
						height={1000}
						priority
						sizes="(max-width: 760px) 62vw, 34vw"
					/>
				</div>
				<div className={styles.heroScrollCue} aria-hidden="true">
					<span />
				</div>
			</header>

			<nav className={styles.chapterNav} aria-label="Capítulos da história">
				{PIPIPI_STORY.parts.map((part) => (
					<a key={part.id} href={`#${part.id}`}>
						<span>{part.number}</span> {part.title}
					</a>
				))}
			</nav>

			<main className={styles.story}>
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
					<div
						className={styles.turningPointText}
						dangerouslySetInnerHTML={{ __html: PIPIPI_STORY.turningPoint.html }}
					/>
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
						width={800}
						height={1000}
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
						width={720}
						height={720}
						aria-hidden="true"
					/>
					<div className={styles.finaleCopy}>
						<div dangerouslySetInnerHTML={{ __html: PIPIPI_STORY.finaleHtml }} />
						<strong>Quando você não consegue salvar alguém, ainda pode ficar.</strong>
					</div>
				</section>
			</main>
		</article>
	);
}
