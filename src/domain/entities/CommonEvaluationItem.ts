export class CommonEvaluationItem {
	constructor(
		public readonly id: number,
		public readonly title: string,
		public readonly description: string,
		public readonly weight: number,
		/** 属する項目セット。null は全等級に共通の項目。同じ項目で評価する等級は同じセットを指す。 */
		public readonly itemSetId: number | null,
	) {}

	equals(other: CommonEvaluationItem): boolean {
		return this.id === other.id;
	}
}
