"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRightIcon, FolderGitIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { skillsShPath } from "@/lib/skills-sh-path";
import { SearchField } from "./search-field";

export function OpenSkillsSh() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const target = skillsShPath(value);
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (target) router.push(target);
      }}
    >
      <SearchField
        icon={<FolderGitIcon />}
        aria-label="skills.sh owner or repository"
        placeholder="Owner, owner/repository or a skills.sh link"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-80 max-w-full"
      />
      <Button type="submit" variant="outline" disabled={!target}>
        Open
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </form>
  );
}
