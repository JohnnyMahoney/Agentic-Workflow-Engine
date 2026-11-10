import type {Policy} from '../surfaces/playwright.js';

// Explicit synthetic harness permissions. Never imported by production code.
// These selectors describe controls in the hand-authored regression fixtures.
export const fixtureSafety: Pick<Policy,'routes'|'privacy'|'operations'> = {
 routes:['/*'],privacy:{dataClass:'synthetic',sensitiveInputs:[],sensitiveSelectors:[],secretEnv:[]},
 operations: [
  {action:'fill',path:'/*',selector:'#q, #name, #member, input[aria-label="Name"]',risk:'safe',allow:true},
  {action:'selectOption',path:'/*',selector:'#type, #t',risk:'safe',allow:true},
  {action:'click',path:'/*',selector:'#member, #go, #f button, #out tbody button, #o, #x, #b, #show',risk:'safe',allow:true},
  {action:'click',path:'/*',selector:'#create, #w button:not([type])',risk:'risky',allow:true},
 ],
};
