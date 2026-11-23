import { describe, expect, it } from "vitest";
import { assistantCapabilities, financialFormProposal, validAssistantResult } from "./assistant";

const proposal = {id:"event",kind:"transaction",type:"expense",amount:"1250.25",unit:"toman",
  category:"food",account_id:null,date:null,source_text:"1250.25 تومان دادم",warnings:["account","date"]};
const result = {protocol_version:1,reference_date:"2026-11-23",proposals:[proposal],unsupported:[]};
describe("household result validation", () => {
  it("checks capability schema without exposing unknown states or kinds", () => {
    expect(assistantCapabilities(null).status).toBe("unavailable");
    expect(assistantCapabilities({status:"surprise"}).status).toBe("unavailable");
    expect(assistantCapabilities({status:"ready",protocol_version:true,kinds:[]}).status).toBe("upgrade_required");
    expect(assistantCapabilities({status:"ready",protocol_version:1,kinds:["transaction","shopping_item","task"]}).status).toBe("upgrade_required");
    expect(assistantCapabilities({status:"ready",protocol_version:2,contextual:true,max_inferences:2,kinds:["transaction","shopping_item","task"]}).status).toBe("ready");
  });
  it("keeps decimal proposal and owned-account contract for the ordinary form", () => {
    expect(validAssistantResult(result)).toBe(true);
    if (!validAssistantResult(result) || result.proposals[0].kind !== "transaction") return;
    const draft = financialFormProposal(result.proposals[0]);
    expect(draft.amount).toBe(1250.25);
    expect(draft.eventId).toBe("event");
    expect(draft.rawText).toBe(proposal.source_text);
  });
  it.each([null, {}, {...result,reference_date:"2026-02-30"}, {...result,protocol_version:99},
    {...result,proposals:[proposal,proposal]}, {...result,proposals:[{...proposal,kind:"tool"}]},
    {...result,proposals:[{...proposal,warnings:null}]}, {...result,proposals:[{...proposal,amount:"NaN"}]},
    {...result,unsupported:[{source_text:"text",reason:"sql"}]}])("fails closed for unusable transport", value => {
    expect(validAssistantResult(value)).toBe(false);
  });
});
