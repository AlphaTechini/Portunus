/** Types for the approval flow (see ApproveSheet.svelte). */

/**
 * The `approval` argument expected by `deposits.payBatch` and `accessKeys.authorize`.
 * Pass it through unchanged.
 */
export interface ApprovalArg {
	method: 'passkey' | 'demo';
	credentialId?: string;
	payloadHash?: string;
	assertion?: {
		authenticatorData: string;
		clientDataJSON: string;
		signatureR: string;
		signatureS: string;
		userVerificationRequired?: boolean;
	};
}

export interface ApprovalResult {
	/** Hand this to the mutation/action as `approval`. */
	approval: ApprovalArg;
	approvedWith: 'passkey' | 'demo';
}

export interface ApprovalRequest {
	/** The `payloadHash` returned by the matching preview/prepare query. This is what the passkey signs. */
	payloadHash: string;
	/** Sheet title. Default "Approve with passkey". */
	title?: string;
	/** One sentence under the title. */
	description?: string;
	/** Headline amount: USD number, or base units as bigint / decimal string (as the backend returns them). */
	amount?: number | bigint | string;
	/** Label for the amount ("Total to pay"). */
	amountLabel?: string;
	/** Key/value rows under the amount ("Containers", "3"). Values are plain text. */
	details?: { label: string; value: string }[];
	/** Passkey button label. Default "Approve". */
	confirmLabel?: string;
	/** Passkey button second line. */
	confirmSublabel?: string;
}

export type RequestApproval = (req: ApprovalRequest) => Promise<ApprovalResult>;
