import { expect, it } from "vitest";
import { exportData } from "../../test/exportFixture";
import { toSheetExportDataDto } from "./ExportSheetMapper";

it("formats missing scores and preserves null comments without mutating input", () => {
	const raw = exportData();
	raw.objectives[0].evaluatorScore = null;
	raw.commonEvaluations[0].evaluatorScore = null;
	raw.commonEvaluations[0].evaluatorComment = null;
	const visible = toSheetExportDataDto(raw, true);
	expect(visible.objectives[0].evaluatorScore).toBe("未評価");
	expect(visible.commonEvaluations[0].evaluatorScore).toBe("未評価");
	expect(visible.commonEvaluations[0].evaluatorComment).toBeNull();
	expect(toSheetExportDataDto(raw, false).commonEvaluations[0].evaluatorComment).toBeNull();
	expect(raw.objectives[0].evaluatorScore).toBeNull();
});
