import Script from "next/script";

const bootstrapTheme = `(()=>{try{const value=localStorage.getItem("tda-theme");const root=document.documentElement;if(value==="light"||value==="dark"){root.dataset.theme=value;root.style.colorScheme=value}else{delete root.dataset.theme;root.style.colorScheme="light dark"}}catch{document.documentElement.style.colorScheme="light dark"}})();`;

export function ThemeBootstrap() {
	return (
		<Script id="theme-bootstrap" strategy="beforeInteractive">
			{bootstrapTheme}
		</Script>
	);
}
