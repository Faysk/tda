import { PIPIPI_STAGE_BACKGROUND } from "@/config/pipipi-assets";
import Image from "next/image";
import { PIPIPI_CINEMATIC_ART_DIRECTION } from "../art-directions/pipipi";
import { PIPIPI_STORY, type PipipiSceneId } from "../pipipi-story";
import { PipipiCinematicScene } from "./pipipi-cinematic-scene";
import mobileStyles from "./pipipi-lore-mobile.module.css";
import styles from "./pipipi-lore-page.module.css";
import polishStyles from "./pipipi-lore-polish.module.css";

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
		background: "https://media.dnd.faysk.dev/lore/pipipi/a2e400c56b9e18db51f06213d211e7ed81118a2675a89feaf460bb5bdb2a1959/casa-bg.avif",
		subject: "https://media.dnd.faysk.dev/lore/pipipi/a3ea5b4cad8cccbe90ed01ad7306436639995120c6bddee01638ca113f647820/casa-subject.avif",
		subjectWidth: 541,
		subjectHeight: 680,
		title: "A Casa tinha outro nome",
		eyebrow: "02 · O outro nome da Casa",
		caption:
			"A Casa tinha corredores, quartos, brinquedos e crianças. Também tinha outro nome.",
		motion: "cinematic",
	},
	"super-herois": {
		background: "https://media.dnd.faysk.dev/lore/pipipi/c372648d38ce17fe1dd3eb70fe4d7a038f13278930f8001efca875b57e889a7d/super-bg.avif",
		subject: "https://media.dnd.faysk.dev/lore/pipipi/0613f27dd4dc910835fe293198ba8a04aaa69f06566c05f034154b2d2aeb720b/super-subject.avif",
		subjectWidth: 544,
		subjectHeight: 680,
		title: "Os super-heróis não vieram salvá-la",
		eyebrow: "A mesma memória, outro significado",
		caption:
			"As fantasias não eram reais. O carinho, a presença e o heroísmo talvez fossem.",
		motion: "cinematic",
	},
	corredores: {
		background: "https://media.dnd.faysk.dev/lore/pipipi/50b5c88cf596b7f8c6d434abc7065df7af9c458710fce82a6c1fecd4f080cd23/corredores-bg.avif",
		subject: "https://media.dnd.faysk.dev/lore/pipipi/2fb0164a92fd12008f53e42e9433212d4787d3d788dc05cd017c662693235b13/corredores-subject.avif",
		subjectWidth: 551,
		subjectHeight: 680,
		title: "Algumas crianças nunca foram para casa",
		eyebrow: "Memória · corredores",
		caption:
			"Pipipi conhecia os corredores e recebia as crianças novas como se a Casa fosse realmente dela.",
		motion: "showcase",
	},
	cadeira: {
		background: "https://media.dnd.faysk.dev/lore/pipipi/5a5a0f4281b46824c4302a815fafff452734d4e1f2908fb4ac4734c88887a26a/cadeira-bg.avif",
		subject: "https://media.dnd.faysk.dev/lore/pipipi/1b9678741fa029ed6c76c84d91f9abdcdc94b91d7b7c44ab40886f9b367c0752/cadeira-subject.avif",
		subjectWidth: 631,
		subjectHeight: 680,
		title: "A cadeira",
		eyebrow: "Ficar também era cuidar",
		caption:
			"Uma cama boa ao lado. Uma cadeira ruim. E uma mãe que preferia continuar perto.",
		motion: "breath",
	},
	"ultimo-dia": {
		background: "https://media.dnd.faysk.dev/lore/pipipi/4f5fdf9203746e4a32592ba924a3ea4a4ec7c98ef8104050a5ec635ea929ae44/ultimo-dia-bg.avif",
		subject: "https://media.dnd.faysk.dev/lore/pipipi/b4be9868ca7af9e31caebe4dfe9939d32c784c8d69455af3fb940b0dfa8cd00a/ultimo-dia-subject.avif",
		subjectWidth: 544,
		subjectHeight: 680,
		title: "O último dia",
		eyebrow: "Todo mundo ficou",
		caption:
			"Pipipi finalmente teve a plateia que queria, sem saber por que ninguém ousaria sair dali.",
		motion: "breath",
	},
	acordou: {
		background: "https://media.dnd.faysk.dev/lore/pipipi/39f409991b7ceb198637333153bd457ab9338a6405e54c79974db54bf24cf982/acordou-bg.avif",
		subject: "https://media.dnd.faysk.dev/lore/pipipi/3db06b2a8216576452e99cc5d485b9d4e5da4fee7f28ff64856b507ef4d1ec9d/acordou-subject.avif",
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
		src: "https://media.dnd.faysk.dev/lore/pipipi/cd04c7e3fbbc647fbf44d18f9b76778a1d31c3b6f56a447cce99aa0a6a437272/ghost-soft.avif",
		position: "right",
		width: 600,
		height: 597,
	},
	"a-ferida-que-pipipi-nunca-nomeou": {
		src: "https://media.dnd.faysk.dev/lore/pipipi/381de7c9a2cd8163891c081ee04f2893f2caa82f5f2d9d88b70e350320d4ae92/ghost-cry.avif",
		position: "left",
		width: 596,
		height: 600,
	},
	"pipipi-e-dandelion": {
		src: "https://media.dnd.faysk.dev/lore/pipipi/135c4fa5a20fd7447d1470944b2a8fc1ce7e8ea69944ae886d9c3bf3d0c23611/ghost-flute.avif",
		position: "right",
		width: 589,
		height: 600,
	},
	"a-pulseirinha": {
		src: "https://media.dnd.faysk.dev/lore/pipipi/4b73eff366efc85b47fdaffcca30d99cf392f21e8c498549dc6a2cc7036ac5ce/ghost-surprise.avif",
		position: "left",
		width: 600,
		height: 590,
	},
	"o-coracao-de-pipipi": {
		src: "https://media.dnd.faysk.dev/lore/pipipi/38ba8074b24a7cf0fc7448d5b13684eadecd785ec07935568654d15170dec84f/ghost-hearts.avif",
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
						style={{ maxWidth: `${ghost.width}px` }}
						unoptimized
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
					src={PIPIPI_STAGE_BACKGROUND}
					alt=""
					fill
					priority
					sizes="100vw"
					unoptimized
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
				<div
					className={`${styles.heroGhost} ${polishStyles.heroGhostIdle}`}
					data-hero-ghost="idle"
					aria-hidden="true"
				>
					<Image
						src="https://media.dnd.faysk.dev/lore/pipipi/135c4fa5a20fd7447d1470944b2a8fc1ce7e8ea69944ae886d9c3bf3d0c23611/ghost-flute.avif"
						alt=""
						width={589}
						height={600}
						priority
						sizes="(max-width: 760px) 62vw, 34vw"
						style={{ maxWidth: "589px" }}
						unoptimized
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
						src="https://media.dnd.faysk.dev/lore/pipipi/3db06b2a8216576452e99cc5d485b9d4e5da4fee7f28ff64856b507ef4d1ec9d/acordou-subject.avif"
						alt="Pipipi como um pequeno fantasminha verde e luminoso."
						width={551}
						height={680}
						sizes="(max-width: 760px) 66vw, 38vw"
						style={{ maxWidth: "551px" }}
						unoptimized
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
						src="https://media.dnd.faysk.dev/lore/pipipi/cd04c7e3fbbc647fbf44d18f9b76778a1d31c3b6f56a447cce99aa0a6a437272/ghost-soft.avif"
						alt=""
						width={600}
						height={597}
						style={{ maxWidth: "600px" }}
						unoptimized
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
