import { describe, expect, it } from "vitest";
import { restoredContextSession, validActionReceipt, validContextResult, validPreparedAction } from "./contextual";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const result = {protocol_version:2,reference_date:"2026-11-23",report_id:id,report_token:"signed",
  sections:[{section:"inventory",status:"empty",rows:[],reference_date:"2026-11-23",window_days:31}],
  facts:[{id:"stock-0",kind:"stock",title:"نان",status:"unknown",rows:[],section:"inventory",conflicts_with_request:false}],
  actions:[{id,kind:"shopping_item",title:"نان",qty:null,unit:null,existing_in:[]}],
  options:[{title:"خرید",action_ids:[id]}],questions:[],proposals:[],unsupported:[],inferences:2};
const review = {operation_id:id,kind:"shopping_item",summary:{title:"نان",list_id:id,destination_title:"صبحانه",qty:"1",unit:null},review_token:"signed",expires_in:900};
describe("contextual runtime contracts", () => {
  it("accepts unknown inventory without replacing it with zero", () => {
    expect(validContextResult(result)).toBe(true);
  });
  it.each([null,{...result,protocol_version:1},{...result,inferences:"2"},{...result,inferences:3},
    {...result,options:[{title:"invented",action_ids:["unknown"]}]},
    {...result,actions:[...result.actions,...result.actions]},
    {...result,sections:[{...result.sections[0],rows:[{secret:()=>1}]}]},
    {...result,facts:[{...result.facts[0],conflicts_with_request:"false"}]}])("rejects malformed report %#", value => {
    expect(validContextResult(value)).toBe(false);
  });
  it("requires exact prepared destination and positive quantity", () => {
    expect(validPreparedAction(review)).toBe(true);
    expect(validPreparedAction({...review,summary:{...review.summary,qty:0}})).toBe(false);
    expect(validPreparedAction({...review,summary:{...review.summary,list_id:null}})).toBe(false);
    expect(validPreparedAction({...review,summary:{...review.summary,title:{bad:true}}})).toBe(false);
    expect(validPreparedAction({...review,expires_in:86400})).toBe(false);
  });
  it("checks durable receipt semantics rather than assuming a save", () => {
    const receipt = {operation_id:id,entity_id:id,kind:"shopping_item",status:"existing",replayed:true};
    expect(validActionReceipt(receipt)).toBe(true);
    expect(validActionReceipt({...receipt,status:"queued"})).toBe(false);
    expect(validActionReceipt({...receipt,replayed:1})).toBe(false);
  });
  it("keeps a pending operation recoverable even when its stored report is malformed", () => {
    const pending = {action_id:id,review};
    expect(restoredContextSession({result:{bad:true},pending,receipts:{}})).toEqual({result:null,pending,receipts:{}});
    expect(restoredContextSession({result:null,pending:{review:null},receipts:[]})).toBeNull();
    expect(restoredContextSession(null)).toBeNull();
  });
});
