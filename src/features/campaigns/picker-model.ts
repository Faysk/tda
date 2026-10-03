import type { CampaignLifecycle } from "./model";

export const CAMPAIGN_PICKER_UNSET = "campaign:unset";

export type CampaignChoice<TValue extends string | null = string> = Readonly<{
	value: TValue;
	label: string;
	lifecycle: CampaignLifecycle;
	disabled?: boolean;
}>;

export type CampaignPickerItem<TValue extends string | null = string> = Readonly<{
	controlValue: string;
	value: TValue;
	label: string;
	lifecycle: CampaignLifecycle;
	disabled: boolean;
}>;

function externalIdentityKey(value: string | null): string {
	return value === null ? "null" : `string:${value}`;
}

export function campaignPickerControlValue(value: string | null): string {
	return value === null
		? "campaign:null"
		: `campaign:string:${encodeURIComponent(value)}`;
}

export function buildCampaignPickerItems<TValue extends string | null>(
	choices: readonly CampaignChoice<TValue>[],
): readonly CampaignPickerItem<TValue>[] {
	const seen = new Set<string>();
	return choices.map((choice) => {
		const identity = externalIdentityKey(choice.value);
		if (seen.has(identity)) {
			throw new Error("Campaign picker choices must use unique values");
		}
		seen.add(identity);
		return {
			controlValue: campaignPickerControlValue(choice.value),
			value: choice.value,
			label:
				choice.lifecycle === "archived"
					? `${choice.label} · Arquivada`
					: choice.label,
			lifecycle: choice.lifecycle,
			disabled: Boolean(choice.disabled),
		};
	});
}

export function selectedCampaignControlValue<TValue extends string | null>(
	items: readonly CampaignPickerItem<TValue>[],
	value: TValue | undefined,
): string | undefined {
	if (value === undefined) return undefined;
	return items.find((item) => item.value === value)?.controlValue;
}

export function campaignValueForControl<TValue extends string | null>(
	items: readonly CampaignPickerItem<TValue>[],
	controlValue: string,
): TValue | undefined {
	return items.find((item) => item.controlValue === controlValue)?.value;
}
