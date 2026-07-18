import { expect, test } from "bun:test"

import { MOA_MODE_MESSAGE } from "./default"

test("MoA keyword guidance routes through the research-first default", () => {
  expect(MOA_MODE_MESSAGE).toContain("research-first")
  expect(MOA_MODE_MESSAGE).toContain("moa_consult")
})
