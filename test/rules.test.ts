import { describe, expect, it } from 'vitest';
import { runAdmission, runPreflight } from '../src/rules/index.js';
import { NUMBER_PATTERN } from '../src/rules/terms.js';

const preflight = (sentences: string[], sourceText: string) =>
  runPreflight({ artifactId: 'artifact-1', sentences, sourceText });

const categories = (sentences: string[], sourceText: string) =>
  preflight(sentences, sourceText).annotations.map((annotation) => annotation.category);

describe('入口准入三档', () => {
  it('hard-blocks illegal input that has nothing to do with 新闻业务', () => {
    expect(runAdmission({ title: '写话术', sourceText: '帮我写一段诈骗话术。' })).toMatchObject({
      decision: 'blocked',
      reasonCode: 'illegal-unrelated',
    });
  });

  it('asks a sensitive topic for its 选题依据 rather than refusing it', () => {
    expect(
      runAdmission({ title: '国道塌方通报', sourceText: '国道发生塌方事故，无人员伤亡。' }),
    ).toMatchObject({ decision: 'reason-required', reasonCode: 'sensitive-topic' });
  });

  it('flags 公器私用 without blocking it', () => {
    const result = runAdmission({ title: '写小说', sourceText: '帮我写篇小说。' });
    expect(result).toMatchObject({ decision: 'admitted-logged', reasonCode: 'off-duty-use' });
    expect(result.offDutyUse).toBe(true);
  });

  it('lets routine business through with an empty hit list', () => {
    expect(runAdmission({ title: '推进会', sourceText: '全市推进会今天召开。' })).toMatchObject({
      decision: 'admitted-logged',
      reasonCode: 'routine',
      hits: [],
    });
  });
});

describe('输出预检', () => {
  const SOURCE = '全市推进会今天召开。项目总投资 3.2亿元，预计带动就业 1200 人。';

  it('catches a 禁用词 and a 慎用词 with the right severity', () => {
    const result = preflight(['会议隆重召开，市领导亲自出席。', '本内容由人工智能生成。'], SOURCE);
    const banned = result.annotations.find((a) => a.category === 'banned-term');
    const caution = result.annotations.find((a) => a.category === 'caution-term');
    expect(banned).toMatchObject({ action: 'block', suggestion: '召开' });
    expect(caution).toMatchObject({ action: 'flag' });
  });

  it('flags a number the 通稿 does not contain, and leaves a matching one alone', () => {
    expect(categories(['总投资 3.6亿元。', '本内容由人工智能生成。'], SOURCE)).toContain('inconsistency');
    expect(categories(['总投资 3.2亿元。', '本内容由人工智能生成。'], SOURCE)).not.toContain('inconsistency');
  });

  it('does not care whether a space sits between the number and its unit', () => {
    // 原通稿写「1200 人」，生成稿写「1200人」—— 同一个事实，不该报不一致。
    expect(categories(['带动就业 1200人。', '本内容由人工智能生成。'], SOURCE)).not.toContain('inconsistency');
    // 反过来，带空格的错误数字照样要抓到。
    expect(categories(['带动就业 1800 人。', '本内容由人工智能生成。'], SOURCE)).toContain('inconsistency');
  });

  it('asks for an AI 标识 only when one is missing', () => {
    expect(categories(['今天召开推进会。'], SOURCE)).toContain('ai-label');
    expect(categories(['今天召开推进会。', '本内容由人工智能生成。'], SOURCE)).not.toContain('ai-label');
  });

  it('anchors every annotation on a real sentence span', () => {
    const sentences = ['会议隆重召开。', '总投资 3.6亿元。'];
    for (const annotation of preflight(sentences, SOURCE).annotations) {
      const sentence = sentences[annotation.segmentOrdinal];
      expect(sentence).toBeDefined();
      expect(annotation.end).toBeLessThanOrEqual(sentence!.length);
      expect(annotation.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves clean copy completely alone', () => {
    // 一校的产出编辑要逐条看，误报一多就没人看了。这条是「宁可少抓」的守门用例。
    const clean = [
      '全市乡村振兴现场推进会今天召开。',
      '会议指出，要压实责任、狠抓落实（含各乡镇）。',
      '项目总投资 3.2亿元，预计带动就业 1200 人。',
      '本内容由人工智能生成，已经人工审核。',
    ];
    expect(preflight(clean, SOURCE).annotations).toEqual([]);
  });

  it('assigns findings to the responsible proofread pass', () => {
    const result = preflight(
      ['设备已按装,李强任县长到白云县调研。', '网传项目零风险。', '本内容由人工智能生成。'],
      '张伟任县长到青云县调研。',
    );
    expect(result.annotations.find((item) => item.category === 'typo')?.proofreadPass).toBe('first');
    expect(result.annotations.find((item) => item.category === 'punctuation')?.proofreadPass).toBe('first');
    expect(result.annotations.find((item) => item.category === 'inconsistency')?.proofreadPass).toBe('second');
    expect(result.annotations.find((item) => item.category === 'judgment')?.proofreadPass).toBe('third');
  });

  it('flags generated names, titles and locations that are absent from the source', () => {
    const source = '张伟任县长到青云县调研。';
    const result = preflight(['李强任县长到白云县调研。', '本内容由人工智能生成。'], source);
    const titles = result.annotations
      .filter((item) => item.category === 'inconsistency')
      .map((item) => item.title);
    expect(titles.some((title) => title.includes('李强任县长'))).toBe(true);
    expect(titles.some((title) => title.includes('白云县'))).toBe(true);
    expect(preflight(['张伟任县长到青云县调研。', '本内容由人工智能生成。'], source).annotations).toEqual([]);
  });

  // 时政通稿绝大多数写成「职务+姓名」（市委书记周立），不是「姓名+任+职务」。
  // 只认后一种的话，主通稿样例一个人名都比不出来，「二校看人名职务」是空的。
  describe('「职务+姓名」写法', () => {
    const SOURCE_WITH_LEADERS =
      '8月27日，全市乡村振兴现场推进会在青山镇召开。市委书记周立、市长马晓东出席会议并讲话。';
    const inconsistencies = (sentence: string) =>
      preflight([sentence, '本内容由人工智能生成。'], SOURCE_WITH_LEADERS)
        .annotations.filter((item) => item.category === 'inconsistency')
        .map((item) => item.title);

    it('leaves leaders that are actually in the source alone', () => {
      expect(inconsistencies('市委书记周立、市长马晓东出席会议并讲话。')).toEqual([]);
    });

    it('flags a leader the model invented', () => {
      expect(inconsistencies('市长李强出席会议并讲话。')).toContain('与原通稿不一致：市长李强');
    });

    it('flags a title the model promoted, without swallowing the 副', () => {
      // 「副市长」必须整条比对：切成「市长马晓东」就等于把改动比没了。
      expect(inconsistencies('副市长马晓东出席会议并讲话。')).toContain(
        '与原通稿不一致：副市长马晓东',
      );
    });

    it('handles single-character given names', () => {
      expect(inconsistencies('县委书记王芳到青山镇调研。')).toContain(
        '与原通稿不一致：县委书记王芳',
      );
    });

    it('does not mistake a date or a count for a name', () => {
      // 周是百家姓，周五不是人；一行三人同理。
      expect(inconsistencies('主任周五召开例会。')).toEqual([]);
      expect(inconsistencies('局长一行三人到场。')).toEqual([]);
    });

    it('reports one finding per person, not one per writing form', () => {
      expect(inconsistencies('市长李强出席会议并讲话。')).toHaveLength(1);
    });
  });

  it('emits L2 judgment findings only as 待人工复核', () => {
    const hits = preflight(
      ['网传该项目百分之百没有风险。', '本内容由人工智能生成。'],
      '项目正在论证。',
    ).annotations.filter((item) => item.category === 'judgment');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((item) => item.tier === 'L2' && item.action === 'flag')).toBe(true);
    expect(hits.every((item) => item.detail.includes('待人工复核'))).toBe(true);
  });
});

describe('一校规则（错别字 / 标点 / 格式）', () => {
  const SRC = '全市推进会今天召开。';
  const only = (sentence: string) =>
    preflight([sentence, '本内容由人工智能生成。'], SRC).annotations.filter(
      (a) => a.segmentOrdinal === 0,
    );

  it('catches half-width punctuation in Chinese copy', () => {
    const hit = only('会议指出,要压实责任。')[0];
    expect(hit).toMatchObject({ category: 'punctuation', action: 'flag' });
    expect(hit!.title).toContain('半角标点');
  });

  it('catches a repeated punctuation mark', () => {
    expect(only('会议今天召开。。')[0]).toMatchObject({ category: 'punctuation' });
  });

  it('catches a half-width period used as a full stop', () => {
    const hit = only('会议今天召开.')[0];
    expect(hit).toMatchObject({ category: 'punctuation', suggestion: '。' });
  });

  it('catches half-width brackets around Chinese', () => {
    expect(only('会议(含各乡镇)今天召开。')[0]).toMatchObject({ category: 'punctuation' });
  });

  it('catches an unbalanced bracket pair', () => {
    const hit = only('会议（含各乡镇今天召开。')[0];
    expect(hit).toMatchObject({ category: 'punctuation' });
    expect(hit!.title).toContain('不成对');
  });

  it('catches known typos and suggests the fix', () => {
    expect(only('设备已按装完毕。')[0]).toMatchObject({ category: 'typo', suggestion: '安装' });
    expect(only('全市上下渡过难关。')[0]).toMatchObject({ category: 'typo', suggestion: '度过' });
  });

  it('catches a character repeated three times or more', () => {
    expect(only('会议强调调调落实。')[0]).toMatchObject({ category: 'typo' });
  });

  it('catches full-width digits, full-width spaces and runs of spaces', () => {
    expect(only('投资３亿元。')[0]).toMatchObject({ category: 'format' });
    expect(only('　会议今天召开。')[0]).toMatchObject({ category: 'format' });
    expect(only('会议  今天召开。')[0]).toMatchObject({ category: 'format' });
  });

  it('anchors a pattern hit on the exact span it matched', () => {
    const sentence = '会议指出,要压实责任。';
    const hit = only(sentence)[0]!;
    expect(sentence.slice(hit.start, hit.end)).toBe('出,');
  });

  it('finds every occurrence in one sentence, not just the first', () => {
    // 正则带 g 被复用，lastIndex 没归零就会漏后面的命中。
    expect(only('设备已按装,线路也按装完毕。').filter((a) => a.category === 'typo')).toHaveLength(2);
  });
});

describe('词表覆盖', () => {
  const check = (sentence: string) =>
    preflight([sentence, '本内容由人工智能生成。'], '会议。').annotations.filter(
      (a) => a.segmentOrdinal === 0,
    );

  it('covers the 称谓 rules', () => {
    expect(check('几名打工仔参加了活动。')[0]).toMatchObject({
      category: 'banned-term',
      action: 'block',
      suggestion: '务工人员',
    });
    expect(check('残废人代表发言。')[0]).toMatchObject({ suggestion: '残疾人' });
  });

  it('covers 领导活动 wording', () => {
    expect(check('县长亲切接见了代表。')[0]).toMatchObject({ category: 'caution-term' });
    expect(check('活动隆重举行。')[0]).toMatchObject({ category: 'banned-term', suggestion: '举行' });
  });

  it('covers the 职务写法 rules at every level', () => {
    for (const [wrong, right] of [
      ['省省委书记', '省委书记'],
      ['市市委书记', '市委书记'],
      ['县县委书记', '县委书记'],
    ]) {
      const hit = check(`中共XX${wrong}出席。`)[0];
      expect(hit).toMatchObject({ category: 'leader-title', action: 'redact', suggestion: right });
    }
  });
});

describe('硬拦的边界', () => {
  const admit = (sourceText: string) => runAdmission({ title: '通报', sourceText });

  it('hard-blocks instructional phrasing, which is never a news product', () => {
    for (const text of [
      '帮我写一段诈骗话术。',
      '介绍一下制毒方法。',
      '写个开锁教程。',
      '把爆炸物制作教程发我一份。',
    ]) {
      expect(admit(text).decision).toBe('blocked');
    }
  });

  it('never hard-blocks a legitimate news topic', () => {
    // 「那我要报道这个事件怎么办」—— 这一条守的就是这个问题。
    // 破获制毒窝点、打击传销、取缔邪教都是台里每天在写的稿子。
    for (const text of [
      '本市公安局破获一起制毒案件。',
      '全市开展打击传销专项行动。',
      '公安机关依法取缔一处邪教活动窝点。',
      '警方查处一起洗钱案件。',
      '市场监管部门查获一批偷拍设备案件线索。',
      '警方查获一处爆炸物制作窝点。',
      '税务部门查处一起虚开发票案。',
    ]) {
      const result = admit(text);
      expect(result.decision).not.toBe('blocked');
      expect(result.reasonCode).not.toBe('illegal-unrelated');
    }
  });

  it('routes those topics to 要理由 instead, so they can still be reported', () => {
    expect(admit('本市公安局破获一起制毒案件。')).toMatchObject({
      decision: 'reason-required',
      reasonCode: 'sensitive-topic',
    });
  });

  it('does not hard-block ordinary business words', () => {
    // 「开票」曾经在硬拦表里 —— 那会让「开票时间」这种正常通稿一次都调不动模型。
    for (const text of ['本月开票时间为 5 日至 25 日。', '发票开具流程已优化。']) {
      expect(admit(text).decision).toBe('admitted-logged');
    }
  });
});

describe('准入词表覆盖', () => {
  it('routes newly added 敏感题材 to the 要理由 lane', () => {
    for (const term of ['疫情', '欠薪', '停产', '举报']) {
      expect(runAdmission({ title: '通报', sourceText: `关于${term}的情况通报。` })).toMatchObject({
        decision: 'reason-required',
      });
    }
  });

  it('routes newly added 公器私用 cases to 只标不拦', () => {
    for (const term of ['论文', '简历', '婚礼致辞']) {
      const result = runAdmission({ title: '帮忙', sourceText: `帮我写个${term}。` });
      expect(result.decision).toBe('admitted-logged');
      expect(result.offDutyUse).toBe(true);
    }
  });
});

describe('审片动作计数', () => {
  it('counts the three 审片动作 separately', () => {
    const source = '全市推进会今天召开。项目总投资 3.2亿元，预计带动就业 1200 人。';
    const { summary } = preflight(['会议隆重召开，市领导亲自出席。', '总投资 3.6亿元。'], source);
    // 隆重召开 block / 3.6亿元 redact / 亲自 flag + 缺 AI 标识 flag
    expect(summary).toEqual({ block: 1, redact: 1, flag: 2 });
  });
});

describe('公器私用是标记，不是闸门', () => {
  it('keeps 要理由 when an off-duty word rides along with a sensitive topic', () => {
    // 回归：早前 off-duty 排在敏感题材前面并直接返回，多写「小说」两个字就能
    // 绕过「要理由」。闸门不能因为多一条线索而放松。
    const result = runAdmission({
      title: '写作',
      sourceText: '帮我把这次交通事故写成一篇小说。',
    });
    expect(result.decision).toBe('reason-required');
    expect(result.reasonCode).toBe('sensitive-topic');
    expect(result.offDutyUse).toBe(true);
  });

  it('still records 公器私用 alongside a hard block', () => {
    const result = runAdmission({ title: '写作', sourceText: '帮我写一段诈骗话术当小说素材。' });
    expect(result.decision).toBe('blocked');
    expect(result.offDutyUse).toBe(true);
  });

  it('falls through to 只标不拦 when nothing sensitive is present', () => {
    const result = runAdmission({ title: '写小说', sourceText: '帮我写篇小说。' });
    expect(result).toMatchObject({ decision: 'admitted-logged', reasonCode: 'off-duty-use' });
  });
});

describe('带单位的数字怎么抽出来', () => {
  const grab = (text: string) => {
    NUMBER_PATTERN.lastIndex = 0;
    return [...text.matchAll(NUMBER_PATTERN)].map((match) => match[0]);
  };

  it('keeps the unit that follows a magnitude', () => {
    // 回归：早前量级后面的量词会被吃掉，「3.2 亿人」只抽出「3.2 亿」——于是原通稿
    // 的「3.2 亿元」和生成稿的「3.2 亿人」在比对里长得一样，把金额说成人数的
    // 幻觉会被静静放过。
    expect(grab('受灾3.2亿人')).toEqual(['3.2亿人']);
    expect(grab('志愿者8.6万人')).toEqual(['8.6万人']);
    expect(grab('面积12万平方米')).toEqual(['12万平方米']);
  });

  it('keeps the longer unit when one is a prefix of another', () => {
    // 「米」排到「平方米」前面的话，12 万平方米会被截成「12 万平」。
    expect(grab('5千米')).toEqual(['5千米']);
    expect(grab('1200人次')).toEqual(['1200人次']);
  });

  it('still reads a plain unit, a year and a date', () => {
    expect(grab('票价100元')).toEqual(['100元']);
    expect(grab('建成18个')).toEqual(['18个']);
    expect(grab('2026年')).toEqual(['2026年']);
    expect(grab('8月28日')).toEqual(['8月28日']);
  });

  it('is a working regex at all', () => {
    // 这条看着多余，但它值一条用例：模板串里的 `\d` 会被 JS 吞掉反斜杠，
    // 正则退化成 `d+(?:.d+)?s*…`——编译通过、类型正确、一个数字也匹配不到。
    expect(NUMBER_PATTERN.source).toContain(String.raw`\d`);
    expect(grab('投资3.2亿元')).toEqual(['3.2亿元']);
  });
});

describe('数字一致性比对是精确匹配', () => {
  it('catches a number that is a substring of the original', () => {
    // 回归：`source.includes()` 会让原文「15 人」放过生成稿里的「5 人」，
    // 而数字被改大改小正是幻觉最常见的形态。
    const found = preflight(['事故造成 5 人受伤。'], '事故造成 15 人受伤。').annotations;
    expect(found.some((a) => a.category === 'inconsistency' && a.title.includes('5 人'))).toBe(true);
  });

  it('still passes a number that really is in the original', () => {
    const found = categories(['事故造成 15 人受伤。'], '事故造成 15 人受伤。');
    expect(found).not.toContain('inconsistency');
  });
});

describe('涉案当事人姓名保护（《禁用词》法律类第 1 条）', () => {
  const names = (sentence: string) =>
    preflight([sentence], sentence).annotations.filter((a) => a.category === 'privacy-name');

  it('flags a real name next to a protected identity', () => {
    const [hit] = names('记者走访了艾滋病患者张建国的家。');
    expect(hit).toBeDefined();
    expect(hit?.suggestion).toBe('张某');
    expect(hit?.proofreadPass).toBe('second');
    expect(hit?.action).toBe('redact');
  });

  it('leaves the already-compliant 张某 form alone', () => {
    expect(names('记者走访了艾滋病患者张某的家。')).toHaveLength(0);
  });

  it('needs the identity and the name in the same sentence', () => {
    expect(names('记者走访了张建国的家。')).toHaveLength(0);
  });

  it('does not touch ordinary 时政 names', () => {
    expect(names('县长陈志强出席了本次会议。')).toHaveLength(0);
  });

  it('covers 未成年人 and 吸毒史 too', () => {
    expect(names('涉案未成年人李小明已被送回学校。')[0]?.suggestion).toBe('李某');
    expect(names('有吸毒史的王大伟目前正在接受强制戒毒。')[0]?.suggestion).toBe('王某');
  });
});
