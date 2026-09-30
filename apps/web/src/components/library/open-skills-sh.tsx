"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { skillsShPath } from "@/lib/skills-sh-path";

export function OpenSkillsSh() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const target = skillsShPath(value);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (target) router.push(target);
      }}
    >
      <Input aria-label="skills.sh owner or repository" placeholder="mattpocock, vercel-labs/agent-skills or a skills.sh link" value={value} onChange={(e) => setValue(e.target.value)} className="max-w-md font-mono" />
      <Button type="submit" variant="outline" disabled={!target}>
        Open
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </form>
  );
}
