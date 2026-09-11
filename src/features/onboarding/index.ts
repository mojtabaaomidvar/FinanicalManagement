/* بارلِ فیچرِ onboarding — نقطه‌ی ورودِ عمومی */
export { OnboardingFeature } from "./ui/OnboardingFeature";
export {
  isIntroSeen,
  markIntroSeen,
  readIntroDraft,
  clearIntroDraft,
  type IntroDraft,
} from "./model/useOnboardingModel";
export { useApplyIntroDraft } from "./model/useApplyIntroDraft";
